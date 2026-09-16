import { createHash } from "node:crypto";
import { id as opaqueId } from "@cvg/contracts";
import type { AiApproval, AiDraft, AiSession, AiTurn, AiTurnInput, AiTurnUsage, CvgContext, DataClass, OpaqueId } from "@cvg/contracts";
import { CvgStore, DomainError, digest, isInContext, makeId, now } from "@cvg/domain";
import { enforceApplicationPolicy } from "@cvg/agent-policy";
import {
  AGENT_RUNTIME_CONTRACT_VERSION,
  buildAiUsageSettlement,
  replayDigest,
  runtimeManifestDigest,
  type AgentDraftPromotion,
  type AgentReplayResult,
  type AgentRuntime,
  type AgentRuntimeCapabilities,
  type AgentRuntimeHealth,
  type AgentTurnResult,
  type RuntimeManifest
} from "@cvg/agent-runtime";
import { LOCAL_POLICY_REVISION, TOOL_REGISTRY, createGovernedToolGateway, type GovernedTool } from "@cvg/harness";
import { ToolGatewayError, toolExecutionDigest, toolRegistryDigest, type ToolDescriptor, type ToolExecutionRequest, type ToolGateway } from "@cvg/agent-tools";
import {
  AgentKernel,
  kernelDigest,
  type KernelBuiltContext,
  type KernelCheckpoint,
  type KernelContextInput,
  type KernelEvent,
  type KernelLoopLimits,
  type KernelMessage,
  KernelModelError,
  type KernelModelOutcome,
  type KernelModelRequest,
  type KernelToolOutcome
} from "@cvg/agent-kernel";
import { ContextBuilder, estimateTokens, sha256Hex, type ContextItem, type ModelContext } from "@cvg/agent-context";
import { AgentSessionError, MemoryAgentSessionStore, type AgentLease, type AgentSessionStore } from "@cvg/agent-session";
import type { PluginRuntime } from "@cvg/agent-plugins";
import { ModelProviderError, ModelRouter, reconcileUsage, withModelRetry, type ModelProvider, type ModelRoutingCandidate } from "@cvg/model-runtime";
import { profileDigest, selectAgentProfile, type AgentProfile } from "./profiles.ts";

export { AGENT_PROFILES, profileDigest, selectAgentProfile, type AgentProfile, type AgentProfileName } from "./profiles.ts";

/**
 * The embedded, provider-neutral agent runtime.  It owns the cognitive loop but
 * never the domain: every side effect crosses the CVG Tool Gateway and the PDP,
 * and the domain knows nothing about which harness or model is in use.
 */

export const EMBEDDED_RUNTIME_VERSION = "embedded-agent-runtime/1.0.0";
export const AGENT_SESSION_TTL_MS = 24 * 60 * 60_000;

export type SupervisorState = "STARTING" | "READY" | "DEGRADED" | "DRAINING" | "UNAVAILABLE" | "STOPPED";

export interface SupervisorSnapshot {
  state: SupervisorState;
  activeTurns: number;
  maxConcurrentTurns: number;
  reason: string | null;
  since: string;
}

/** Supervisor: owns runtime health, concurrency limits, drain and shutdown. */
export class AgentRuntimeSupervisor {
  private currentState: SupervisorState = "STARTING";
  private activeTurns = 0;
  private reason: string | null = null;
  private since: string;
  private drainResolvers: (() => void)[] = [];

  constructor(
    private readonly options: { maxConcurrentTurns: number; drainDeadlineMs: number; clock?: { now(): number } }
  ) {
    this.since = this.iso();
  }

  start(): SupervisorSnapshot {
    if (this.currentState === "STARTING" || this.currentState === "UNAVAILABLE") this.transition("READY");
    return this.snapshot();
  }

  markUnavailable(reason: string): void {
    this.reason = reason;
    this.transition("UNAVAILABLE");
  }

  markDegraded(reason: string): void {
    this.reason = reason;
    if (this.currentState === "READY") this.transition("DEGRADED");
  }

  markReady(): void {
    this.reason = null;
    this.transition("READY");
  }

  tryBeginTurn(): boolean {
    if (this.currentState !== "READY" && this.currentState !== "DEGRADED") return false;
    if (this.activeTurns >= this.options.maxConcurrentTurns) return false;
    this.activeTurns += 1;
    return true;
  }

  endTurn(): void {
    if (this.activeTurns > 0) this.activeTurns -= 1;
    if (this.activeTurns === 0 && this.currentState === "DRAINING") {
      for (const resolve of this.drainResolvers.splice(0)) resolve();
    }
  }

  async drain(): Promise<{ state: SupervisorState; drained: boolean; waitedMs: number }> {
    if (this.currentState === "STOPPED") return { state: this.currentState, drained: true, waitedMs: 0 };
    this.transition("DRAINING");
    const started = this.now();
    if (this.activeTurns === 0) {
      this.transition("STOPPED");
      return { state: this.currentState, drained: true, waitedMs: 0 };
    }
    await new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
      setTimeout(resolve, this.options.drainDeadlineMs);
    });
    const drained = this.activeTurns === 0;
    this.transition("STOPPED");
    return { state: this.currentState, drained, waitedMs: this.now() - started };
  }

  snapshot(): SupervisorSnapshot {
    return { state: this.currentState, activeTurns: this.activeTurns, maxConcurrentTurns: this.options.maxConcurrentTurns, reason: this.reason, since: this.since };
  }

  private transition(state: SupervisorState): void {
    this.currentState = state;
    this.since = this.iso();
  }

  private now(): number {
    return this.options.clock ? this.options.clock.now() : Date.now();
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }
}

export interface EmbeddedRuntimeControls {
  aiEnabled: boolean;
  safeMode: boolean;
  disabledProviders: readonly string[];
  disabledTools: readonly string[];
  disabledPlugins: readonly string[];
}

export const DEFAULT_RUNTIME_CONTROLS: EmbeddedRuntimeControls = { aiEnabled: true, safeMode: false, disabledProviders: [], disabledTools: [], disabledPlugins: [] };

export interface EmbeddedTelemetryPort {
  increment(metric: string, value?: number): void;
  recordKernelEvent(event: KernelEvent): void;
}

export interface EmbeddedToolExecution {
  status: "COMPLETED";
  resultDigest: string | null;
  resultPreview: string | null;
}

export type EmbeddedToolExecutor = (input: { tool: GovernedTool; parsedInput: unknown; context: CvgContext; session: AiSession; signal: AbortSignal }) => Promise<EmbeddedToolExecution>;

export interface EmbeddedTurnDiagnostics {
  sessionId: string;
  runId: string;
  stopCondition: string;
  reason: string;
  providerId: string | null;
  model: string | null;
  turns: number;
  toolCalls: number;
  tokensUsed: number;
  costMicrosUsed: number;
  costKnown: boolean;
  sanitizedContext: boolean;
  checkpointDigest: string;
  fence: number | null;
}

export interface EmbeddedAgentRuntimeOptions {
  store: CvgStore;
  modelProvider: ModelProvider;
  fallbackProviders?: readonly ModelProvider[];
  sessionStore?: AgentSessionStore;
  toolExecutor?: EmbeddedToolExecutor;
  telemetry?: EmbeddedTelemetryPort | null;
  controls?: () => EmbeddedRuntimeControls;
  /** Optional plugin runtime so the plugin kill switch is enforced, not just declared. */
  pluginRuntime?: PluginRuntime | null;
  /** Optional close hook (for example ending a dedicated agent-runtime database pool). */
  onClose?: () => Promise<void> | void;
  clock?: { now(): number };
  runtimeCommit?: string | null;
  instanceId?: string;
  maxConcurrentTurns?: number;
  drainDeadlineMs?: number;
  modelRetryAttempts?: number;
  allowProviderFallback?: boolean;
}

interface TurnRunState {
  pausedTurn: AiTurn | null;
  lastReservationId: string | null;
  reservedUnits: number;
  consumedUnits: number;
  usageStatus: AiTurnUsage["status"];
  references: { title: string; source: string }[];
  providerId: string | null;
  model: string | null;
  modelResponseDigests: string[];
  usageSource: "PROVIDER" | "LOCAL_SYNTHETIC" | "UNAVAILABLE" | null;
  sanitized: boolean;
  usedDataClasses: DataClass[];
  contextDigest: string | null;
}

function emptyRunState(): TurnRunState {
  return {
    pausedTurn: null,
    lastReservationId: null,
    reservedUnits: 0,
    consumedUnits: 0,
    usageStatus: "SETTLED",
    references: [],
    providerId: null,
    model: null,
    modelResponseDigests: [],
    usageSource: null,
    sanitized: false,
    usedDataClasses: [],
    contextDigest: null
  };
}

export class EmbeddedAgentRuntime implements AgentRuntime {
  readonly adapterId = "embedded-governed-kernel";
  private readonly supervisor: AgentRuntimeSupervisor;
  private readonly sessionStore: AgentSessionStore;
  private readonly gateway: ToolGateway;
  private readonly contextBuilder = new ContextBuilder();
  private readonly inFlightTurns = new Map<string, Promise<AgentTurnResult>>();
  private readonly instanceId: string;
  private readonly runtimeCommit: string;
  private readonly router: ModelRouter;

  constructor(private readonly options: EmbeddedAgentRuntimeOptions) {
    this.instanceId = options.instanceId ?? makeId();
    this.runtimeCommit = options.runtimeCommit ?? process.env.CVG_BUILD_SHA ?? process.env.CVG_GIT_SHA ?? "uncommitted";
    this.supervisor = new AgentRuntimeSupervisor({
      maxConcurrentTurns: options.maxConcurrentTurns ?? 8,
      drainDeadlineMs: options.drainDeadlineMs ?? 10_000,
      ...(options.clock ? { clock: options.clock } : {})
    });
    this.supervisor.start();
    this.sessionStore = options.sessionStore ?? new MemoryAgentSessionStore(options.clock ? { now: () => options.clock!.now() } : undefined);
    this.gateway = createGovernedToolGateway(options.store);
    const candidates: ModelRoutingCandidate[] = [
      { provider: options.modelProvider, priority: 0, enabled: () => !this.controls().disabledProviders.includes(options.modelProvider.providerId) },
      ...(options.fallbackProviders ?? []).map((provider, index) => ({ provider, priority: index + 1, enabled: () => !this.controls().disabledProviders.includes(provider.providerId) }))
    ];
    this.router = new ModelRouter(candidates);
  }

  runtimeManifest(): RuntimeManifest {
    return {
      runtimeVersion: EMBEDDED_RUNTIME_VERSION,
      runtimeCommit: this.runtimeCommit,
      agentContractVersion: AGENT_RUNTIME_CONTRACT_VERSION,
      pluginApiVersion: "cvg-agent-plugin/1",
      skillSchemaVersion: "cvg-agent-skill/1",
      toolRegistryDigest: toolRegistryDigest(this.gateway.list()),
      policyRevision: LOCAL_POLICY_REVISION,
      supportedModelProviders: [this.options.modelProvider.providerId, ...(this.options.fallbackProviders ?? []).map((provider) => provider.providerId)].sort()
    };
  }

  runtimeManifestDigest(): string {
    return runtimeManifestDigest(this.runtimeManifest());
  }

  supervisorSnapshot(): SupervisorSnapshot {
    return this.supervisor.snapshot();
  }

  capabilities(): AgentRuntimeCapabilities {
    return {
      adapterId: this.adapterId,
      provider: this.options.modelProvider.providerId,
      engineCommit: this.runtimeCommit,
      manifestVersion: EMBEDDED_RUNTIME_VERSION,
      toolNames: TOOL_REGISTRY.map((tool) => tool.name),
      supports: { cancellation: true, approvals: true, replay: true, provenance: true }
    };
  }

  private controls(): EmbeddedRuntimeControls {
    return this.options.controls?.() ?? DEFAULT_RUNTIME_CONTROLS;
  }

  /** @pdp-exempt health — readiness metadata has no actor/resource/data access. */
  async health(): Promise<AgentRuntimeHealth> {
    const capabilities = this.capabilities();
    const checkedAt = this.iso();
    const controls = this.controls();
    if (!controls.aiEnabled) return { status: "DISABLED", capabilities, checkedAt, reason: "AI_DISABLED" };
    const supervisor = this.supervisor.snapshot();
    if (supervisor.state === "STOPPED" || supervisor.state === "DRAINING") return { status: "UNAVAILABLE", capabilities, checkedAt, reason: `RUNTIME_${supervisor.state}` };
    try {
      const providerHealth = await this.options.modelProvider.health();
      if (providerHealth.status === "READY") {
        this.supervisor.markReady();
        return { status: "READY", capabilities, checkedAt, reason: null };
      }
      if (providerHealth.status === "DEGRADED") return { status: "DEGRADED", capabilities, checkedAt, reason: providerHealth.reason ?? "PROVIDER_DEGRADED" };
      return { status: "UNAVAILABLE", capabilities, checkedAt, reason: providerHealth.reason ?? "MODEL_UNAVAILABLE" };
    } catch {
      return { status: "UNAVAILABLE", capabilities, checkedAt, reason: "MODEL_HEALTH_FAILED" };
    }
  }

  async createSession(context: CvgContext, input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">): Promise<AiSession> {
    enforceApplicationPolicy(context, `ai.turn.${input.purpose}`, { resourceId: input.patientId ?? input.encounterId });
    this.options.store.requireRole(context, ["admin", "veterinario", "recepcao"], "ai:session");
    const profile = selectAgentProfile(input.purpose);
    const session: AiSession = {
      id: makeId(),
      organizationId: context.organizationId,
      actorId: context.actorId,
      unitId: context.unitId,
      workspaceId: context.workspaceId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      purpose: input.purpose,
      engineCommit: this.runtimeCommit,
      profileDigest: profileDigest(profile),
      status: "ACTIVE",
      createdAt: now()
    };
    const persisted = this.options.store.persistAiSession(session);
    await this.sessionStore.create({
      sessionId: persisted.id,
      organizationId: context.organizationId,
      actorId: context.actorId,
      unitId: context.unitId,
      workspaceId: context.workspaceId,
      purpose: input.purpose,
      taskObjective: "",
      ttlMs: AGENT_SESSION_TTL_MS
    });
    return persisted;
  }

  async executeTurn(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId | null = null): Promise<AgentTurnResult> {
    this.options.store.validateContext(context);
    enforceApplicationPolicy(context, `ai.turn.${input.purpose}`, { resourceId: input.resourceId ?? input.encounterId ?? input.patientId });
    const controls = this.controls();
    if (!controls.aiEnabled) throw new DomainError("DEPENDENCY_UNAVAILABLE", "O runtime de IA está desabilitado.", 503, { reason: "AI_DISABLED" });
    const executionKey = this.executionKey(context, input);
    const effectiveApprovalId = approvalId ?? input.approvalId ?? null;
    const existing = this.findExistingTurn(context, input);
    if (existing) {
      if (existing.prompt !== input.prompt) throw new DomainError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada com outros argumentos.", 409);
      const isReplayOnly = existing.status !== "RECEIVED" || !effectiveApprovalId;
      if (isReplayOnly) return this.resultForExisting(context, existing);
    }
    const inFlight = this.inFlightTurns.get(executionKey);
    if (inFlight) return inFlight;
    const execution = this.executeTurnOnce(context, input, effectiveApprovalId);
    this.inFlightTurns.set(executionKey, execution);
    try {
      return await execution;
    } finally {
      if (this.inFlightTurns.get(executionKey) === execution) this.inFlightTurns.delete(executionKey);
    }
  }

  async approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null): Promise<AiApproval> {
    enforceApplicationPolicy(context, "ai.approval", { resourceId: approvalId });
    this.options.store.requireRole(context, ["admin", "veterinario", "recepcao", "estoque", "financeiro"], "ai:approval");
    const approval = this.options.store.aiApprovals.get(approvalId);
    if (!approval || approval.sessionId === undefined) throw new DomainError("NOT_FOUND", "Aprovação não encontrada.", 404);
    const session = this.options.store.aiSessions.get(approval.sessionId);
    const tool = TOOL_REGISTRY.find((candidate) => candidate.name === approval.toolName);
    if (!tool || !session || session.organizationId !== context.organizationId || session.actorId !== approval.actorId || approval.organizationId !== context.organizationId || approval.unitId !== context.unitId || approval.workspaceId !== context.workspaceId || approval.policyRevision !== context.policyRevision || Date.parse(approval.expiresAt) <= Date.now()) {
      throw new DomainError("POLICY_DENIED", "A aprovação expirou ou não corresponde ao contexto atual.", 403);
    }
    try {
      this.options.store.requireRole(context, tool.allowedRoles, tool.capability);
    } catch (error) {
      if (error instanceof DomainError && error.code === "FORBIDDEN") throw new DomainError("POLICY_DENIED", "A aprovação não corresponde à alçada atual.", 403);
      throw error;
    }
    if (tool.risk === "HIGH_IMPACT" && approval.actorId === context.actorId) throw new DomainError("POLICY_DENIED", "Ações de alto impacto exigem aprovador independente.", 403);
    if (approval.decision !== "unavailable") throw new DomainError("CONFLICT", "Aprovação já foi decidida.", 409);
    return this.options.store.updateAiApproval(approvalId, { decision, decidedBy: context.actorId, reason });
  }

  async promoteDraft(context: CvgContext, draftId: OpaqueId): Promise<AgentDraftPromotion> {
    enforceApplicationPolicy(context, "ai.draft.promote", { resourceId: draftId });
    this.options.store.requireRole(context, ["veterinario"], "clinical:write");
    const draft = this.options.store.aiDrafts.get(draftId);
    if (!draft || draft.encounterId === null) throw new DomainError("NOT_FOUND", "Rascunho clínico não encontrado.", 404);
    const encounter = this.options.store.encounters.get(draft.encounterId);
    if (!encounter || encounter.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Atendimento não encontrado.", 404);
    if (draft.status !== "DRAFT" && draft.status !== "REVIEWED") throw new DomainError("CONFLICT", "Rascunho não está disponível para promoção.", 409);
    const document = this.options.store.createClinicalDocument(context, { encounterId: encounter.id, documentType: "EVOLUTION", title: "Rascunho do copiloto — revisão humana", content: draft.content, dataClass: "D3" });
    const promoted = this.options.store.updateAiDraftStatus(draftId, "PROMOTED");
    return { draft: promoted, documentId: document.id };
  }

  async replay(context: CvgContext, sessionId: OpaqueId): Promise<AgentReplayResult> {
    enforceApplicationPolicy(context, "ai.replay", { resourceId: sessionId });
    this.options.store.requireRole(context, ["admin", "veterinario", "recepcao"], "ai:replay");
    const session = this.options.store.aiSessions.get(sessionId);
    if (!session || session.organizationId !== context.organizationId || session.actorId !== context.actorId || !isInContext(session, context)) throw new DomainError("NOT_FOUND", "Sessão de copiloto não encontrada.", 404);
    const turns = [...this.options.store.aiTurns.values()].filter((turn) => turn.sessionId === sessionId);
    return { session, turns, digest: replayDigest(session, turns), provenance: this.capabilities() };
  }

  /** Cancels a running turn for the given session; returns true when a signal was aborted. */
  cancel(sessionId: OpaqueId): boolean {
    for (const [key, controller] of this.turnControllers) {
      if (key.startsWith(`${sessionId}:`)) {
        controller.abort(new Error("CANCELLED_BY_OPERATOR"));
        return true;
      }
    }
    return false;
  }

  private readonly turnControllers = new Map<string, AbortController>();

  async shutdown(): Promise<void> {
    await this.supervisor.drain();
    try {
      await this.options.onClose?.();
    } catch {
      this.options.telemetry?.increment("agent_runtime_close_failed", 1);
    }
  }

  private async executeTurnOnce(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId | null): Promise<AgentTurnResult> {
    if (!this.supervisor.tryBeginTurn()) throw new DomainError("DEPENDENCY_UNAVAILABLE", "O runtime de IA está saturado ou indisponível.", 503, { reason: this.supervisor.snapshot().reason ?? "RUNTIME_UNAVAILABLE" });
    try {
      return await this.executeTurnCore(context, input, approvalId);
    } finally {
      this.supervisor.endTurn();
    }
  }

  private async executeTurnCore(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId | null): Promise<AgentTurnResult> {
    enforceApplicationPolicy(context, `ai.turn.${input.purpose}`, { resourceId: input.resourceId ?? input.encounterId ?? input.patientId });
    if (!context.sessionId) throw new DomainError("POLICY_DENIED", "A execução de IA exige uma sessão autenticada.", 403);
    await this.reconcilePluginKillSwitches();
    const session = await this.getOrCreateSession(context, input);
    if (!isInContext(session, context) || session.patientId !== input.patientId || session.encounterId !== input.encounterId || session.purpose !== input.purpose) throw new DomainError("POLICY_DENIED", "O contexto do turno não pode mudar a finalidade, o escopo, o paciente ou atendimento de uma sessão existente.", 403);
    const profile = selectAgentProfile(input.purpose);
    const runState = emptyRunState();
    const prompt = input.prompt;
    if (this.looksLikeInjection(prompt)) {
      const turn = this.persistTurn(context, session, prompt, "QUARANTINED", "Conteúdo retido: o texto recebido é dado não confiável e não pode alterar policy ou tools.", { profile, runState, usageStatus: "QUARANTINED", reservedUnits: 0, consumedUnits: 0, idempotencyKey: this.executionKey(context, input), inputTokens: estimateTokens(prompt), outputTokens: 0 });
      return this.result(context, session, turn, null, null, []);
    }
    const requestedTool = input.requestedTool ? TOOL_REGISTRY.find((candidate) => candidate.name === input.requestedTool) : undefined;
    if (input.requestedTool && !requestedTool) {
      const turn = this.persistTurn(context, session, prompt, "DENIED", "Tool não registrada no profile CVG.", { profile, runState, idempotencyKey: this.executionKey(context, input), inputTokens: estimateTokens(prompt), outputTokens: 0 });
      throw new DomainError("POLICY_DENIED", "A capability solicitada não está registrada.", 403, { turnId: turn.id });
    }
    if (requestedTool) {
      if (!profile.allowedTools.includes(requestedTool.name)) {
        const turn = this.persistTurn(context, session, prompt, "DENIED", "A tool não pertence ao profile do agente para esta finalidade.", { profile, runState, idempotencyKey: this.executionKey(context, input), inputTokens: estimateTokens(prompt), outputTokens: 0 });
        throw new DomainError("POLICY_DENIED", "A capability não está disponível para este profile.", 403, { turnId: turn.id });
      }
      try {
        this.options.store.requireRole(context, requestedTool.allowedRoles, requestedTool.capability);
      } catch (error) {
        if (error instanceof DomainError && error.code === "FORBIDDEN") {
          const turn = this.persistTurn(context, session, prompt, "DENIED", "Role sem permissão para a capability solicitada.", { profile, runState, idempotencyKey: this.executionKey(context, input), inputTokens: estimateTokens(prompt), outputTokens: 0 });
          throw new DomainError("POLICY_DENIED", "A capability não está disponível para este perfil.", 403, { turnId: turn.id });
        }
        throw error;
      }
    }

    const lease = await this.acquireLease(context, session.id, profile.budgets.maxWallTimeMs);
    const controller = new AbortController();
    const controllerKey = `${session.id}:${makeId()}`;
    this.turnControllers.set(controllerKey, controller);
    try {
      return await this.runKernelLoop(context, session, input, profile, approvalId, lease, runState, controller);
    } finally {
      this.turnControllers.delete(controllerKey);
      await this.releaseLease(session.id, lease);
    }
  }

  private async runKernelLoop(
    context: CvgContext,
    session: AiSession,
    input: AiTurnInput,
    profile: AgentProfile,
    approvalId: OpaqueId | null,
    lease: AgentLease,
    runState: TurnRunState,
    controller: AbortController
  ): Promise<AgentTurnResult> {
    const runId = makeId();
    const prompt = input.prompt;
    const fence = lease.fence;
    const rawCheckpoint = approvalId ? await this.loadCheckpoint(context, session.id) : null;
    // The checkpoint stores digests, not raw content; the resumed model context is
    // re-seeded with the user objective so the conversation survives a restart.
    const resumeCheckpoint = rawCheckpoint ? { ...rawCheckpoint, history: [{ role: "user" as const, content: prompt }, ...rawCheckpoint.history.slice(-4)] } : null;

    const limits: Partial<KernelLoopLimits> = {
      maxTurns: profile.budgets.maxTurns,
      maxToolCalls: profile.budgets.maxToolCalls,
      maxTokens: profile.budgets.maxTokens,
      maxWallTimeMs: profile.budgets.maxWallTimeMs,
      maxCostMicros: profile.budgets.maxCostMicros,
      maxFailures: profile.budgets.maxFailures,
      maxRepeatedToolCalls: 2
    };

    const kernel = new AgentKernel({
      clock: { now: () => (this.options.clock ? this.options.clock.now() : Date.now()) },
      budget: {
        state: () => runState.usageStatus === "SETTLED" ? "SETTLED" : runState.lastReservationId ? "RESERVED" : "AVAILABLE",
        reserve: ({ units }) => {
          try {
            const reservation = this.options.store.reserveBudget(context, { sessionId: session.id, category: "TOKENS", units, cap: profile.budgets.maxTokens, ttlMs: 5 * 60_000 });
            runState.lastReservationId = reservation.id;
            runState.reservedUnits = reservation.reservedUnits;
            return { status: "RESERVED", reservationId: reservation.id, reason: null };
          } catch (error) {
            if (error instanceof DomainError && error.code === "BUDGET_EXCEEDED") return { status: "EXCEEDED", reservationId: null, reason: "BUDGET_EXCEEDED" };
            return { status: "UNKNOWN", reservationId: null, reason: "BUDGET_PORT_FAILURE" };
          }
        },
        settle: ({ reservationId, units }) => {
          try {
            const settlement = this.options.store.settleBudgetReservation(opaqueId(reservationId), units);
            runState.consumedUnits = settlement.reservation.consumedUnits;
            runState.usageStatus = "SETTLED";
            return { status: "SETTLED", consumedUnits: settlement.reservation.consumedUnits };
          } catch {
            runState.usageStatus = "RECONCILIATION_REQUIRED";
            return { status: "UNKNOWN", consumedUnits: units };
          }
        },
        release: (reservationId) => {
          try {
            this.options.store.releaseBudgetReservation(opaqueId(reservationId));
          } catch {
            runState.usageStatus = "RECONCILIATION_REQUIRED";
          }
        }
      },
      model: {
        capabilities: () => {
          const capabilities = this.options.modelProvider.capabilities();
          return {
            toolCalling: capabilities.toolCalling,
            structuredOutput: capabilities.structuredOutput,
            streaming: capabilities.streaming,
            reasoning: capabilities.reasoning,
            vision: capabilities.vision,
            contextWindow: capabilities.contextWindow,
            maxOutput: capabilities.maxOutput
          };
        },
        invoke: async (request, signal) => this.invokeModel(request, signal, runState, profile, controller, context)
      },
      context: {
        build: async (kernelInput) => this.buildContext(context, session, input, profile, kernelInput, runState)
      },
      tools: {
        request: async (request) => this.requestTool(context, session, input, profile, request, approvalId, runState, fence, controller)
      },
      events: {
        emit: (event) => {
          this.options.telemetry?.recordKernelEvent(event);
          this.options.telemetry?.increment(`agent_kernel_${event.name.replace(/[^a-zA-Z0-9]/g, "_")}`, 1);
        }
      }
    });

    const kernelInput = {
      runId,
      sessionId: session.id,
      objective: prompt,
      purpose: input.purpose,
      systemInstructions: profile.instructions,
      actorContext: {
        organizationId: context.organizationId,
        unitId: context.unitId,
        workspaceId: context.workspaceId,
        purpose: context.purpose,
        roles: context.actorRoleSnapshot.join(",")
      },
      availableTools: profile.allowedTools.filter((tool) => !this.controls().disabledTools.includes(tool)),
      limits,
      signal: controller.signal,
      ...(resumeCheckpoint ? { resume: resumeCheckpoint } : {}),
      ...(approvalId ? { approvalId: String(approvalId) } : { approvalId: null }),
      ...(input.requestedTool && !resumeCheckpoint
        ? { initialTool: { tool: input.requestedTool, input: { aiSessionId: session.id, prompt, purpose: input.purpose, patientId: input.patientId, encounterId: input.encounterId, resourceId: input.resourceId ?? null, toolInput: null } } }
        : {})
    };
    const result = await kernel.run(kernelInput);
    runState.sanitized = result.sanitizedContext;
    const usageTotals = result.turns.reduce(
      (totals, turn) => ({ inputTokens: totals.inputTokens + (turn.usage?.inputTokens ?? 0), outputTokens: totals.outputTokens + (turn.usage?.outputTokens ?? 0) }),
      { inputTokens: 0, outputTokens: 0 }
    );
    const idempotencyKey = this.executionKey(context, input);

    if (result.stopCondition === "WAITING_HUMAN" && result.pendingApproval) {
      const pausedTurn = runState.pausedTurn ?? this.persistTurn(context, session, prompt, "RECEIVED", null, {
        profile,
        runState: { ...runState, usageStatus: "RECEIVED" },
        usageStatus: "RECEIVED",
        idempotencyKey,
        inputTokens: usageTotals.inputTokens,
        outputTokens: usageTotals.outputTokens
      });
      await this.assertLeaseHeld(context, session.id, lease);
      await this.saveCheckpoint(context, session.id, fence, result.checkpoint, runState);
      const pausedLedger = await this.appendLedgerTurn(context, session, input, runState, pausedTurn, result, fence, "WAITING_APPROVAL");
      if (!pausedLedger) throw new DomainError("DEPENDENCY_UNAVAILABLE", "O ledger de turnos não pôde registrar a pausa; a aprovação não foi retornada.", 503);
      const approval = [...this.options.store.aiApprovals.values()].find((candidate) => candidate.id === (result.pendingApproval!.approvalId as OpaqueId)) ?? null;
      return this.result(context, session, pausedTurn, null, approval, []);
    }

    const status = this.mapTurnStatus(result.stopCondition, result.outcomeUnknown);
    const response = result.answer;
    await this.assertLeaseHeld(context, session.id, lease);
    const persistedTurn = runState.pausedTurn ?? this.persistTurn(context, session, prompt, status, response, {
      profile,
      runState,
      idempotencyKey,
      inputTokens: usageTotals.inputTokens,
      outputTokens: usageTotals.outputTokens
    });
    const ledgerOk = await this.appendLedgerTurn(context, session, input, runState, persistedTurn, result, fence, status === "COMPLETED" ? "COMPLETED" : status === "DENIED" ? "DENIED" : status === "QUARANTINED" ? "DENIED" : "UNKNOWN");
    // A turn without a durable ledger entry is never reported as COMPLETED.
    const turn = ledgerOk ? persistedTurn : this.options.store.persistAiTurn(this.downgradeTurn(persistedTurn));
    let draft: AiDraft | null = null;
    if (status === "COMPLETED" && input.purpose === "DRAFT_CLINICAL" && response) {
      const createdDraft: AiDraft = { id: makeId(), sessionId: session.id, encounterId: input.encounterId, draftType: "CLINICAL_NOTE", content: response, sourceTurnId: turn.id, status: "DRAFT", createdAt: now() };
      draft = this.options.store.persistAiDraft(createdDraft);
    }
    return this.result(context, session, turn, draft, null, runState.references);
  }

  private async invokeModel(
    request: KernelModelRequest,
    signal: AbortSignal,
    runState: TurnRunState,
    profile: AgentProfile,
    controller: AbortController,
    context: CvgContext
  ): Promise<KernelModelOutcome> {
    const controls = this.controls();
    const decision = this.router.route({
      requiredCapabilities: request.tools.length > 0 ? ["toolCalling"] : [],
      dataClasses: runState.usedDataClasses.length > 0 ? runState.usedDataClasses : ["D0"],
      allowedFallback: this.options.allowProviderFallback ?? false,
      modelProviderId: null
    });
    if (!decision.allowed || !decision.providerId) {
      throw new KernelModelError("DEPENDENCY_UNAVAILABLE", `Model routing denied: ${decision.reason}`, false);
    }
    const provider = this.providerById(decision.providerId);
    if (!provider) throw new KernelModelError("DEPENDENCY_UNAVAILABLE", "Model provider is not registered", false);
    if (controls.safeMode && request.tools.length > 0 && !provider.capabilities().toolCalling) {
      throw new KernelModelError("DEPENDENCY_UNAVAILABLE", "AI_SAFE_MODE requires a tool-calling provider", false);
    }
    const modelRequest = {
      systemInstructions: request.systemInstructions,
      messages: request.messages.map((message) => ({ role: message.role, content: message.content, ...(message.toolName !== undefined ? { toolName: message.toolName } : {}) })),
      tools: request.tools.map((tool) => ({ name: tool.name, version: tool.version, description: tool.description, risk: tool.risk, inputSchemaDigest: tool.inputSchemaDigest })),
      maxOutputTokens: request.maxOutputTokens,
      temperature: null,
      purpose: request.purpose,
      contextDigest: request.contextDigest,
      responseFormat: "TEXT" as const,
      correlationId: context.correlationId
    };
    try {
      const response = await withModelRetry(() => provider.complete(modelRequest, { signal, timeoutMs: profile.budgets.maxWallTimeMs }), {
        maxAttempts: this.options.modelRetryAttempts ?? 2
      });
      this.router.recordOutcome(provider.providerId, true);
      runState.providerId = response.providerId;
      runState.model = response.model;
      runState.usageSource = response.usage.source;
      runState.modelResponseDigests.push(response.responseDigest);
      const reply = response.reply.kind === "MESSAGE"
        ? ({ kind: "MESSAGE", content: response.reply.content } as const)
        : response.reply.kind === "TOOL_CALL"
          ? ({ kind: "TOOL_REQUEST", tool: response.reply.tool, input: response.reply.input, rationale: null } as const)
          : ({ kind: "MESSAGE", content: JSON.stringify(response.reply.value) } as const);
      return {
        reply,
        usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, costMicros: response.usage.costMicros, currency: response.usage.currency, source: response.usage.source },
        providerId: response.providerId,
        model: response.model,
        responseDigest: response.responseDigest,
        retryable: response.retryable
      };
    } catch (error) {
      this.router.recordOutcome(provider.providerId, false);
      throw this.mapModelError(error, controller);
    }
  }

  private mapModelError(error: unknown, controller: AbortController): KernelModelError {
    if (controller.signal.aborted) return new KernelModelError("CANCELLED", "Model call was cancelled", false);
    if (error instanceof KernelModelError) return error;
    if (error instanceof ModelProviderError) {
      switch (error.code) {
        case "MODEL_TIMEOUT":
          return new KernelModelError("MODEL_TIMEOUT", error.message, true);
        case "MODEL_INVALID_RESPONSE":
          return new KernelModelError("MODEL_INVALID_RESPONSE", error.message, true);
        case "MODEL_CONTEXT_TOO_LARGE":
          return new KernelModelError("CONTEXT_TOO_LARGE", error.message, false);
        case "MODEL_CANCELLED":
          return new KernelModelError("CANCELLED", error.message, false);
        case "MODEL_UNAVAILABLE":
        case "MODEL_RATE_LIMITED":
          return new KernelModelError("MODEL_UNAVAILABLE", error.message, true);
        default:
          return new KernelModelError("DEPENDENCY_UNAVAILABLE", error.message, false);
      }
    }
    return new KernelModelError("MODEL_UNAVAILABLE", error instanceof Error ? error.message : "unknown model failure", true);
  }

  private async buildContext(
    context: CvgContext,
    session: AiSession,
    input: AiTurnInput,
    profile: AgentProfile,
    kernelInput: KernelContextInput,
    runState: TurnRunState
  ): Promise<KernelBuiltContext> {
    const business: ContextItem[] = [];
    if (input.patientId) {
      const patient = this.options.store.patients.get(input.patientId);
      if (patient && patient.organizationId === context.organizationId && isInContext(patient, context)) {
        const projection = { id: patient.id, name: patient.name, species: patient.species, unitId: patient.unitId };
        business.push({
          id: `patient:${patient.id}`,
          kind: "patient.projection",
          trust: "CVG_TRUSTED",
          priority: 800,
          content: JSON.stringify(projection),
          dataClass: "D3",
          tokens: estimateTokens(JSON.stringify(projection)),
          provenance: { source: "cvg.patients", owner: "CVG", version: String(patient.createdAt), digest: sha256Hex(JSON.stringify(projection)), retrievedAt: this.iso() }
        });
      }
    }
    const retrieval: ContextItem[] = [...this.options.store.knowledgeDocuments.values()]
      .filter((document) => document.organizationId === context.organizationId && isInContext(document, context) && document.status === "APPROVED" && profile.allowedDataClasses.includes(document.dataClass))
      .filter((document) => !this.looksLikeInjection(`${document.title}\n${document.source}\n${document.content}`))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, 4)
      .map((document) => ({
        id: `knowledge:${document.id}`,
        kind: document.title,
        trust: "RETRIEVED_UNTRUSTED",
        priority: 500,
        content: document.content,
        dataClass: document.dataClass,
        tokens: estimateTokens(document.content),
        provenance: { source: document.source, owner: "CVG knowledge", version: String(document.version), digest: sha256Hex(`${document.title}|${document.source}|${document.content}`), retrievedAt: this.iso() }
      }));

    const toolContracts = profile.allowedTools
      .filter((name) => !this.controls().disabledTools.includes(name))
      .map((name) => TOOL_REGISTRY.find((tool) => tool.name === name))
      .filter((tool): tool is GovernedTool => Boolean(tool))
      .map((tool) => ({
        name: tool.name,
        version: tool.version,
        description: tool.description,
        risk: tool.risk,
        inputSchemaDigest: sha256Hex(JSON.stringify(tool))
      }));

    const built: ModelContext = this.contextBuilder.build({
      systemInstructions: `[CVG GOVERNED RUNTIME]\n${profile.instructions}`,
      agentProfile: {
        name: profile.name,
        version: profile.version,
        digest: profileDigest(profile),
        instructions: profile.instructions,
        allowedTools: profile.allowedTools,
        allowedDataClasses: profile.allowedDataClasses,
        allowedSkills: profile.allowedSkills
      },
      actor: { actorId: String(context.actorId), roles: [...context.actorRoleSnapshot], organizationId: String(context.organizationId), unitId: context.unitId ? String(context.unitId) : null, workspaceId: context.workspaceId ? String(context.workspaceId) : null, purpose: context.purpose },
      task: { objective: kernelInput.objective, state: session.status, completedObjectives: [], pendingObjectives: [] },
      toolContracts,
      conversation: kernelInput.history.map((message) => ({ role: message.role, content: message.content, turn: 0 })),
      retrieval,
      criticalBusinessContext: business,
      tokenBudget: Math.min(profile.budgets.maxTokens, 16_000),
      maxUntrustedItems: 4
    });
    runState.references = built.retrievalReferences.map((reference) => ({ title: reference.title, source: reference.source }));
    runState.sanitized = runState.sanitized || built.sanitized;
    runState.contextDigest = built.digest;
    runState.usedDataClasses = [...new Set(built.items.map((item) => item.dataClass))];
    const messages: KernelMessage[] = built.items
      .filter((item) => item.role !== "system")
      .map((item) => {
        const message: KernelMessage = { role: item.role as "user" | "assistant" | "tool", content: item.content };
        return message;
      });
    return {
      systemInstructions: built.systemInstructions,
      messages,
      toolContracts: built.toolContracts,
      estimatedTokens: built.tokens.total,
      contextDigest: built.digest,
      sanitized: built.sanitized
    };
  }

  private async requestTool(
    context: CvgContext,
    session: AiSession,
    input: AiTurnInput,
    profile: AgentProfile,
    request: { tool: string; input: unknown; turn: number; approvalId: string | null; signal: AbortSignal },
    approvalId: OpaqueId | null,
    runState: TurnRunState,
    fence: number,
    controller: AbortController
  ): Promise<KernelToolOutcome> {
    const controls = this.controls();
    const tool = TOOL_REGISTRY.find((candidate) => candidate.name === request.tool);
    if (!tool) return deniedTool("TOOL_NOT_REGISTERED");
    if (!profile.allowedTools.includes(tool.name)) return deniedTool("PROFILE_TOOL_NOT_ALLOWED");
    if (controls.disabledTools.includes(tool.name)) return deniedTool("TOOL_KILL_SWITCH");
    if (controls.safeMode && tool.risk !== "READ_ONLY") return deniedTool("SAFE_MODE_READ_ONLY");
    if (tool.risk === "HIGH_IMPACT" && !profile.riskLimits.allowHighImpact) return deniedTool("PROFILE_RISK_LIMIT");
    if (controller.signal.aborted) return cancelledTool();
    const descriptor = this.gateway.get(tool.name) as ToolDescriptor | undefined;
    if (!descriptor) return deniedTool("CAPABILITY_DISABLED");
    const approval = approvalId ? this.options.store.aiApprovals.get(approvalId) : undefined;
    const gatewayRequest = this.gatewayRequest(context, session, input, tool, request.input, approval);
    const requestDigest = toolExecutionDigest(descriptor, gatewayRequest, gatewayRequest.input);

    if (tool.requiresApproval) {
      const validApproval = approvalId ? this.validateApproval(context, session, input, tool, approvalId, requestDigest) : null;
      if (approvalId && !validApproval) return deniedTool("APPROVAL_INVALID_OR_CONSUMED");
      if (approval && validApproval && approval.decision === "allowed-once") {
        // Consume the one-shot approval BEFORE the effect: a crash after
        // dispatch must never leave a reusable approval behind.
        this.options.store.updateAiApproval(approval.id, { decision: "consumed" });
      }
      if (!approval) {
        const pausedTurn = runState.pausedTurn ?? this.persistTurn(context, session, input.prompt, "RECEIVED", null, {
          profile,
          runState: { ...runState, usageStatus: "RECEIVED" },
          usageStatus: "RECEIVED",
          idempotencyKey: this.executionKey(context, input),
          inputTokens: 0,
          outputTokens: runState.consumedUnits
        });
        runState.pausedTurn = pausedTurn;
        const pendingApproval = this.createPendingApproval(context, session, input, tool, requestDigest, pausedTurn.id);
        return {
          status: "APPROVAL_REQUIRED",
          resultDigest: null,
          resultPreview: null,
          errorCode: null,
          errorMessage: null,
          approval: { approvalId: pendingApproval.id, requestDigest, expiresAt: pendingApproval.expiresAt },
          progress: null,
          retryable: false
        };
      }
    }
    try {
      const execution = await this.gateway.execute(tool.name, { ...gatewayRequest, requestDigest }, async (parsedInput: unknown, signal: AbortSignal) => {
        const executor = this.options.toolExecutor ?? this.defaultToolExecutor.bind(this);
        return executor({ tool, parsedInput, context, session, signal });
      });
      runState.lastReservationId = runState.lastReservationId ?? null;
      return {
        status: "COMPLETED",
        resultDigest: digest(execution.result ?? null),
        resultPreview: previewOf(execution.result),
        errorCode: null,
        errorMessage: null,
        approval: null,
        progress: null,
        retryable: false
      };
    } catch (error) {
      if (error instanceof ToolGatewayError) {
        if (error.code === "OUTCOME_UNKNOWN") return { status: "OUTCOME_UNKNOWN", resultDigest: null, resultPreview: null, errorCode: "TOOL_OUTCOME_UNKNOWN", errorMessage: error.message, approval: null, progress: null, retryable: false };
        if (error.code === "APPROVAL_REQUIRED") {
          const pausedTurn = runState.pausedTurn ?? this.persistTurn(context, session, input.prompt, "RECEIVED", null, {
            profile,
            runState: { ...runState, usageStatus: "RECEIVED" },
            usageStatus: "RECEIVED",
            idempotencyKey: this.executionKey(context, input),
            inputTokens: 0,
            outputTokens: runState.consumedUnits
          });
          runState.pausedTurn = pausedTurn;
          const pendingApproval = this.createPendingApproval(context, session, input, tool, requestDigest, pausedTurn.id);
          return { status: "APPROVAL_REQUIRED", resultDigest: null, resultPreview: null, errorCode: null, errorMessage: null, approval: { approvalId: pendingApproval.id, requestDigest, expiresAt: pendingApproval.expiresAt }, progress: null, retryable: false };
        }
        return deniedTool(error.code);
      }
      if (controller.signal.aborted) return cancelledTool();
      return { status: "FAILED", resultDigest: null, resultPreview: null, errorCode: "TOOL_PORT_FAILURE", errorMessage: error instanceof Error ? error.message : "unknown", approval: null, progress: null, retryable: false };
    }
  }

  private defaultToolExecutor(): Promise<EmbeddedToolExecution> {
    return Promise.resolve({ status: "COMPLETED", resultDigest: null, resultPreview: "executor sintético local; nenhum efeito externo foi executado" });
  }

  private validateApproval(context: CvgContext, session: AiSession, input: AiTurnInput, tool: GovernedTool, approvalId: OpaqueId, requestDigest: string): boolean {
    const approval = this.options.store.aiApprovals.get(approvalId);
    if (!approval) return false;
    if (approval.organizationId !== context.organizationId || approval.actorId !== session.actorId || approval.sessionId !== session.id || approval.toolName !== tool.name) return false;
    if (approval.resourceId !== (input.resourceId ?? input.encounterId ?? input.patientId)) return false;
    if (approval.patientId !== input.patientId || approval.encounterId !== input.encounterId) return false;
    if (approval.unitId !== context.unitId || approval.workspaceId !== context.workspaceId || approval.purpose !== input.purpose) return false;
    if (approval.policyRevision !== context.policyRevision || approval.requestDigest !== requestDigest) return false;
    if (Date.parse(approval.expiresAt) <= Date.now()) return false;
    if (approval.decidedBy === null || approval.decision !== "allowed-once") return false;
    if (tool.risk === "HIGH_IMPACT" && approval.decidedBy === approval.actorId) return false;
    const originalTurn = this.options.store.aiTurns.get(approval.turnId);
    if (!originalTurn || originalTurn.prompt !== input.prompt) return false;
    return true;
  }

  private createPendingApproval(context: CvgContext, session: AiSession, input: AiTurnInput, tool: GovernedTool, requestDigest: string, turnId: OpaqueId): AiApproval {
    const existing = [...this.options.store.aiApprovals.values()].find((candidate) => candidate.sessionId === session.id && candidate.toolName === tool.name && candidate.requestDigest === requestDigest && candidate.decision === "unavailable" && Date.parse(candidate.expiresAt) > Date.now());
    if (existing) return existing;
    const pending: AiApproval = {
      id: makeId(),
      organizationId: context.organizationId,
      actorId: context.actorId,
      sessionId: session.id,
      turnId,
      toolName: tool.name,
      resourceId: input.resourceId ?? input.encounterId ?? input.patientId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      unitId: context.unitId,
      workspaceId: context.workspaceId,
      purpose: input.purpose,
      requestDigest,
      policyRevision: context.policyRevision,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      decision: "unavailable",
      decidedBy: null,
      reason: "Ação exige confirmação contextual e não pode ser presumida.",
      createdAt: now()
    };
    return this.options.store.persistAiApproval(pending);
  }

  private gatewayRequest(context: CvgContext, session: AiSession, input: AiTurnInput, tool: GovernedTool, toolInput: unknown, approval: AiApproval | undefined): ToolExecutionRequest {
    const request: ToolExecutionRequest = {
      context,
      sessionId: context.sessionId!,
      resource: { organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, resourceId: input.resourceId ?? input.encounterId ?? input.patientId, dataClass: input.patientId ? "D3" : tool.acceptedDataClasses[0] ?? "D0" },
      input: { aiSessionId: session.id, prompt: input.prompt, purpose: input.purpose, patientId: input.patientId, encounterId: input.encounterId, resourceId: input.resourceId, toolInput },
      idempotencyKey: input.idempotencyKey
    };
    if (approval) request.approval = { approvalId: approval.id, actorId: approval.actorId, approverId: approval.decidedBy, requestDigest: approval.requestDigest, policyRevision: approval.policyRevision, expiresAt: approval.expiresAt, oneShot: true, consumed: approval.decision === "consumed" };
    return request;
  }

  private async acquireLease(context: CvgContext, sessionId: OpaqueId, wallBudgetMs: number): Promise<AgentLease> {
    // The lease covers the whole wall budget plus a safety margin so a long
    // turn cannot silently outlive its own fence.
    const ttlMs = Math.max(wallBudgetMs + 180_000, 180_000);
    try {
      const lease = await this.sessionStore.acquireLease({ sessionId: String(sessionId), organizationId: String(context.organizationId), ownerId: this.instanceId, ttlMs });
      if (!lease) throw new DomainError("ADMISSION_IN_PROGRESS", "Outra instância executa esta sessão; nenhum turno paralelo foi iniciado.", 409);
      return lease;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (error instanceof AgentSessionError && error.code === "DENIED_STALE_FENCE") throw new DomainError("DENIED_STALE_FENCE", error.message, 409);
      if (error instanceof AgentSessionError && error.code === "LEASE_HELD") throw new DomainError("ADMISSION_IN_PROGRESS", error.message, 409);
      // An unusable session store must never be treated as "no lease": fail closed.
      throw new DomainError("DEPENDENCY_UNAVAILABLE", `O armazenamento de sessão do agente não está disponível: ${error instanceof Error ? error.message : "erro desconhecido"}`, 503);
    }
  }

  /** Renews the lease before any authoritative write; a lost lease aborts the turn. */
  private async assertLeaseHeld(context: CvgContext, sessionId: OpaqueId, lease: AgentLease): Promise<void> {
    const renewed = await this.sessionStore.renewLease({ sessionId: String(sessionId), organizationId: String(context.organizationId), ownerId: lease.ownerId, ttlMs: 180_000, fence: lease.fence });
    if (!renewed) throw new DomainError("DENIED_STALE_FENCE", "O lease da sessão foi perdido antes da escrita autoritativa.", 409);
  }

  private async releaseLease(sessionId: OpaqueId, lease: AgentLease | null): Promise<void> {
    if (!lease) return;
    try {
      await this.sessionStore.releaseLease({ sessionId: String(sessionId), organizationId: String(lease.organizationId), ownerId: lease.ownerId, fence: lease.fence });
    } catch {
      // Releasing a lease is best-effort; an expired lease is re-acquirable with a higher fence.
    }
  }

  /** Runtime kill switch: plugins disabled by the control plane stop offering capabilities. */
  private async reconcilePluginKillSwitches(): Promise<void> {
    const runtime = this.options.pluginRuntime;
    if (!runtime) return;
    const disabled = this.controls().disabledPlugins;
    if (disabled.length === 0) return;
    for (const record of runtime.snapshot()) {
      if (disabled.includes(record.name) && (record.state === "READY" || record.state === "DEGRADED")) {
        await runtime.disable(record.name, "runtime kill switch");
        this.options.telemetry?.increment("agent_plugin_kill_switch", 1);
      }
    }
  }

  /** Durable turn ledger: append-only, fenced and bound to the kernel digests. */
  private async appendLedgerTurn(
    context: CvgContext,
    session: AiSession,
    input: AiTurnInput,
    runState: TurnRunState,
    turn: AiTurn,
    result: { turns: readonly { turn: number; modelRequestDigest: string; modelResponseDigest: string | null; toolName: string | null; usage?: { inputTokens: number; outputTokens: number } | null }[]; loop: { startedAt: string; completedAt: string | null } },
    fence: number,
    status: "COMPLETED" | "DENIED" | "WAITING_APPROVAL" | "UNKNOWN"
  ): Promise<boolean> {
    const lastTurn = result.turns.at(-1);
    try {
      await this.sessionStore.appendTurn({
        turnId: String(turn.id),
        sessionId: String(session.id),
        organizationId: String(context.organizationId),
        sequence: 0,
        status,
        inputDigest: kernelDigest({ prompt: input.prompt, purpose: input.purpose, tool: input.requestedTool, patientId: input.patientId, encounterId: input.encounterId }),
        contextDigest: runState.contextDigest,
        modelRequestDigest: lastTurn?.modelRequestDigest ?? null,
        modelResponseDigest: lastTurn?.modelResponseDigest ?? null,
        toolRequestIds: result.turns.map((entry) => entry.toolName).filter((name): name is string => name !== null),
        usageRecordId: turn.usage?.id ? String(turn.usage.id) : null,
        provenance: { provider: runState.providerId ?? "", model: runState.model ?? "", runtimeVersion: EMBEDDED_RUNTIME_VERSION, fence },
        startedAt: result.loop.startedAt,
        completedAt: result.loop.completedAt,
        fence
      });
      return true;
    } catch (error) {
      if (error instanceof AgentSessionError && error.code === "DENIED_STALE_FENCE") throw new DomainError("DENIED_STALE_FENCE", error.message, 409);
      this.options.telemetry?.increment("agent_kernel_turn_ledger_append_failed", 1);
      return false;
    }
  }

  /** A turn whose ledger entry could not be written is not authoritative. */
  private downgradeTurn(turn: AiTurn): AiTurn {
    const usage = turn.usage ? { ...turn.usage, status: "RECONCILIATION_REQUIRED" as const } : undefined;
    return {
      ...turn,
      status: "OUTCOME_UNKNOWN",
      response: null,
      references: [],
      ...(usage ? { usage } : {})
    };
  }

  private async saveCheckpoint(context: CvgContext, sessionId: OpaqueId, fence: number, checkpoint: KernelCheckpoint, runState: TurnRunState): Promise<void> {
    try {
      const payload = { checkpoint: { ...checkpoint, history: checkpoint.history }, runState: { providerId: runState.providerId, model: runState.model, usageStatus: runState.usageStatus, pendingTool: checkpoint.pendingTool } };
      await this.sessionStore.checkpoint({ sessionId: String(sessionId), organizationId: String(context.organizationId), fence, payload });
    } catch (error) {
      if (error instanceof AgentSessionError && error.code === "DENIED_STALE_FENCE") throw new DomainError("DENIED_STALE_FENCE", error.message, 409);
      // Without a durable checkpoint the pause is not recoverable: fail closed
      // instead of returning an approval that no restart could resume.
      throw new DomainError("DEPENDENCY_UNAVAILABLE", `O checkpoint da sessão não pôde ser persistido: ${error instanceof Error ? error.message : "erro desconhecido"}`, 503);
    }
  }

  private async loadCheckpoint(context: CvgContext, sessionId: OpaqueId): Promise<KernelCheckpoint | null> {
    try {
      const record = await this.sessionStore.latestCheckpoint(String(sessionId), { organizationId: String(context.organizationId), actorId: String(context.actorId) });
      if (!record) return null;
      const checkpoint = (record.payload as { checkpoint?: KernelCheckpoint }).checkpoint;
      return checkpoint ?? null;
    } catch {
      return null;
    }
  }

  private async getOrCreateSession(context: CvgContext, input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId" | "sessionId">): Promise<AiSession> {
    this.options.store.validateContext(context);
    if (input.sessionId) {
      const existing = this.options.store.aiSessions.get(input.sessionId);
      if (!existing || existing.organizationId !== context.organizationId || existing.actorId !== context.actorId || !isInContext(existing, context) || existing.status !== "ACTIVE") throw new DomainError("NOT_FOUND", "Sessão de copiloto não encontrada.", 404);
      return existing;
    }
    const profile = selectAgentProfile(input.purpose);
    const session: AiSession = {
      id: makeId(),
      organizationId: context.organizationId,
      actorId: context.actorId,
      unitId: context.unitId,
      workspaceId: context.workspaceId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      purpose: input.purpose,
      engineCommit: this.runtimeCommit,
      profileDigest: profileDigest(profile),
      status: "ACTIVE",
      createdAt: now()
    };
    const persisted = this.options.store.persistAiSession(session);
    try {
      await this.sessionStore.create({ sessionId: persisted.id, organizationId: context.organizationId, actorId: context.actorId, unitId: context.unitId, workspaceId: context.workspaceId, purpose: input.purpose, taskObjective: "", ttlMs: AGENT_SESSION_TTL_MS });
    } catch (error) {
      throw new DomainError("DEPENDENCY_UNAVAILABLE", `A sessão durável do agente não pôde ser criada: ${error instanceof Error ? error.message : "erro desconhecido"}`, 503);
    }
    return persisted;
  }

  private executionKey(context: CvgContext, input: AiTurnInput): string {
    return `ai-turn:${digest({ version: 1, organizationId: context.organizationId, actorId: context.actorId, idempotencyKey: input.idempotencyKey })}`;
  }

  private findExistingTurn(context: CvgContext, input: AiTurnInput): AiTurn | undefined {
    const usageKey = this.executionKey(context, input);
    return [...this.options.store.aiTurns.values()]
      .filter((turn) => {
        if (turn.usage?.idempotencyKey !== usageKey) return false;
        const session = this.options.store.aiSessions.get(turn.sessionId);
        return Boolean(session) && session!.organizationId === context.organizationId && session!.actorId === context.actorId && session!.unitId === context.unitId && session!.workspaceId === context.workspaceId && session!.purpose === input.purpose && session!.patientId === input.patientId && session!.encounterId === input.encounterId;
      })
      .at(-1);
  }

  private resultForExisting(context: CvgContext, turn: AiTurn): AgentTurnResult {
    const session = this.options.store.aiSessions.get(turn.sessionId);
    if (!session) throw new DomainError("OUTCOME_UNKNOWN", "O turno idempotente perdeu o vínculo da sessão.", 409);
    const draft = [...this.options.store.aiDrafts.values()].find((candidate) => candidate.sourceTurnId === turn.id) ?? null;
    const approval = [...this.options.store.aiApprovals.values()].find((candidate) => candidate.turnId === turn.id) ?? null;
    return this.result(context, session, turn, draft, approval, [...turn.references]);
  }

  private mapTurnStatus(stopCondition: string, outcomeUnknown: boolean): AiTurn["status"] {
    if (outcomeUnknown) return "OUTCOME_UNKNOWN";
    if (stopCondition === "TASK_COMPLETED" || stopCondition === "WAITING_HUMAN") return "COMPLETED";
    if (stopCondition === "POLICY_DENIED" || stopCondition === "CANCELLED" || stopCondition === "BUDGET_EXCEEDED") return "DENIED";
    if (stopCondition === "TIMEOUT" || stopCondition === "DEPENDENCY_UNAVAILABLE" || stopCondition === "ERROR" || stopCondition === "NO_PROGRESS") return "OUTCOME_UNKNOWN";
    return "OUTCOME_UNKNOWN";
  }

  private persistTurn(
    context: CvgContext,
    session: AiSession,
    prompt: string,
    status: AiTurn["status"],
    response: string | null,
    options: {
      profile: AgentProfile;
      runState: TurnRunState;
      idempotencyKey: string;
      usageStatus?: AiTurnUsage["status"];
      reservedUnits?: number;
      consumedUnits?: number;
      inputTokens?: number;
      outputTokens?: number;
    }
  ): AiTurn {
    const id = makeId();
    const usageId = makeId();
    const provider = options.runState.providerId ?? this.options.modelProvider.providerId;
    const model = options.runState.model ?? "unknown-model";
    const references = status === "COMPLETED" || status === "RECEIVED" ? [...options.runState.references] : [];
    const referencesDigest = digest(references);
    const inputTokens = options.inputTokens ?? 0;
    const outputTokens = options.outputTokens ?? 0;
    const reservedUnits = options.reservedUnits ?? options.runState.reservedUnits;
    const consumedUnits = options.consumedUnits ?? inputTokens + outputTokens;
    const settlement = buildAiUsageSettlement({
      model,
      inputTokens,
      outputTokens,
      providerResponseDigest: options.runState.modelResponseDigests.length > 0 ? kernelDigest(options.runState.modelResponseDigests) : null,
      estimatedCostMicros: null,
      actualCostMicros: null,
      currency: null,
      costSource: "UNAVAILABLE",
      pricingRevision: null,
      discrepancy: "NOT_EVALUATED",
      discrepancyDeltaMicros: null,
      discrepancyReason: "provider pricing evidence was not supplied"
    });
    const unknownUsage = options.runState.usageSource === null || options.runState.usageSource === "UNAVAILABLE";
    const usageStatus: AiTurnUsage["status"] = options.usageStatus ?? (status === "OUTCOME_UNKNOWN" || (status === "COMPLETED" && unknownUsage) ? "RECONCILIATION_REQUIRED" : status === "RECEIVED" ? "RECEIVED" : status === "QUARANTINED" ? "QUARANTINED" : "SETTLED");
    const turn: AiTurn = {
      id,
      sessionId: session.id,
      prompt,
      response,
      status,
      model,
      inputTokens,
      outputTokens,
      references,
      provenance: {
        provider,
        engineCommit: this.runtimeCommit,
        manifestVersion: EMBEDDED_RUNTIME_VERSION,
        profileDigest: profileDigest(options.profile),
        policyRevision: context.policyRevision,
        references,
        referencesDigest,
        correlationId: context.correlationId,
        usageRecordId: usageId
      },
      usage: {
        id: usageId,
        reservationId: options.runState.lastReservationId ? opaqueId(options.runState.lastReservationId) : null,
        providerRequestId: null,
        idempotencyKey: options.idempotencyKey,
        usageKind: "TOKENS",
        reservedUnits,
        consumedUnits,
        status: usageStatus,
        record: {
          kind: "AI_TURN_USAGE",
          turnId: id,
          sessionId: session.id,
          model,
          provider,
          engineCommit: this.runtimeCommit,
          manifestVersion: EMBEDDED_RUNTIME_VERSION,
          profileDigest: profileDigest(options.profile),
          policyRevision: context.policyRevision,
          correlationId: context.correlationId,
          referencesDigest,
          responseDigest: digest(response ?? ""),
          reservationId: options.runState.lastReservationId,
          reservedUnits,
          consumedUnits,
          reconciliation: reconcileUsage(reservedUnits, inputTokens + outputTokens > 0 ? { inputTokens, outputTokens, costMicros: null, currency: null, source: "UNAVAILABLE" } : null)
        },
        settlement
      },
      createdAt: now()
    };
    return this.options.store.persistAiTurn(turn);
  }

  private result(context: CvgContext, session: AiSession, turn: AiTurn, draft: AiDraft | null, approval: AiApproval | null, references: { title: string; source: string }[]): AgentTurnResult {
    return {
      session,
      turn,
      draft,
      approval,
      provenance: {
        provider: turn.provenance?.provider ?? this.options.modelProvider.providerId,
        engineCommit: this.runtimeCommit,
        manifestVersion: EMBEDDED_RUNTIME_VERSION,
        profileDigest: turn.provenance?.profileDigest ?? profileDigest(selectAgentProfile(session.purpose)),
        policyRevision: context.policyRevision,
        references,
        referencesDigest: digest(references),
        correlationId: context.correlationId,
        ...(turn.usage?.id ? { usageRecordId: turn.usage.id } : {})
      }
    };
  }

  private providerById(providerId: string): ModelProvider | undefined {
    if (this.options.modelProvider.providerId === providerId) return this.options.modelProvider;
    return this.options.fallbackProviders?.find((provider) => provider.providerId === providerId);
  }

  private looksLikeInjection(prompt: string): boolean {
    return /ignore\s+(all\s+)?previous|ignore\s+(as\s+)?instru[cç][õo]es|system\s*prompt|reveal\s+(the\s+)?secret|tool\s*allowlist|<\s*system/i.test(prompt);
  }

  private iso(): string {
    return new Date(this.options.clock ? this.options.clock.now() : Date.now()).toISOString();
  }
}

function deniedTool(code: string, requestDigest?: string): KernelToolOutcome {
  return { status: "DENIED", resultDigest: null, resultPreview: null, errorCode: code, errorMessage: null, approval: null, progress: null, retryable: false, ...(requestDigest ? { resultPreview: `digest:${requestDigest.slice(0, 16)}` } : {}) };
}

function cancelledTool(): KernelToolOutcome {
  return { status: "CANCELLED", resultDigest: null, resultPreview: null, errorCode: "CANCELLED", errorMessage: null, approval: null, progress: null, retryable: false };
}

function previewOf(result: unknown): string | null {
  if (result === null || result === undefined) return null;
  const text = typeof result === "string" ? result : JSON.stringify(result);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}
