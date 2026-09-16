import { createHash } from "node:crypto";

/**
 * The Agent Kernel is the provider-neutral cognitive loop.  It knows only
 * abstract contracts: no Patient, Guardian, Appointment, Hospitalization,
 * Finance or Stock.  Every side effect is delegated to an injected port, so
 * the kernel can never bypass the CVG Tool Gateway or the PDP.
 */

export const AGENT_KERNEL_VERSION = "agent-kernel/1.0.0";

export type KernelState =
  | "CREATED"
  | "OBSERVING"
  | "CONTEXT_BUILDING"
  | "MODEL_PENDING"
  | "MODEL_COMPLETED"
  | "TOOL_PENDING"
  | "TOOL_COMPLETED"
  | "VERIFYING"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "QUARANTINED"
  | "CANCELLED";

export type KernelStopCondition =
  | "TASK_COMPLETED"
  | "WAITING_HUMAN"
  | "BUDGET_EXCEEDED"
  | "POLICY_DENIED"
  | "CANCELLED"
  | "TIMEOUT"
  | "NO_PROGRESS"
  | "DEPENDENCY_UNAVAILABLE"
  | "ERROR";

export type KernelBudgetState = "AVAILABLE" | "RESERVED" | "SETTLED" | "EXCEEDED" | "UNKNOWN";

export interface KernelLoopLimits {
  maxTurns: number;
  maxToolCalls: number;
  maxTokens: number;
  maxWallTimeMs: number;
  maxCostMicros: number | null;
  maxFailures: number;
  /** Identical tool signature repetitions tolerated before LOOP_DETECTED. */
  maxRepeatedToolCalls?: number;
}

export const DEFAULT_KERNEL_LIMITS: KernelLoopLimits = {
  maxTurns: 6,
  maxToolCalls: 4,
  maxTokens: 32_000,
  maxWallTimeMs: 60_000,
  maxCostMicros: null,
  maxFailures: 2,
  maxRepeatedToolCalls: 2
};

export interface KernelClock {
  now(): number;
}

export interface KernelMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Digest of the originating content; raw sensitive payloads stay in the session store. */
  digest?: string;
  toolName?: string;
}

export interface KernelToolContract {
  name: string;
  version: string;
  description: string;
  risk: "READ_ONLY" | "DRAFT" | "REVERSIBLE" | "HIGH_IMPACT";
  inputSchemaDigest: string;
}

export interface KernelModelCapabilities {
  toolCalling: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  reasoning: boolean;
  vision: boolean;
  contextWindow: number;
  maxOutput: number;
}

export interface KernelModelRequest {
  systemInstructions: string;
  messages: readonly KernelMessage[];
  tools: readonly KernelToolContract[];
  maxOutputTokens: number;
  purpose: string;
  /** Opaque, already-minimized context projection; the kernel never inspects it. */
  contextDigest: string;
}

export interface KernelModelUsage {
  inputTokens: number;
  outputTokens: number;
  costMicros: number | null;
  currency: string | null;
  source: "PROVIDER" | "LOCAL_SYNTHETIC" | "UNAVAILABLE";
}

export type KernelModelReply =
  | { kind: "MESSAGE"; content: string }
  | { kind: "TOOL_REQUEST"; tool: string; input: unknown; rationale: string | null }
  | { kind: "INVALID_RESPONSE"; reason: string };

export interface KernelModelOutcome {
  reply: KernelModelReply;
  usage: KernelModelUsage;
  providerId: string;
  model: string;
  responseDigest: string;
  retryable: boolean;
}

export class KernelModelError extends Error {
  constructor(
    readonly code:
      | "MODEL_UNAVAILABLE"
      | "MODEL_TIMEOUT"
      | "MODEL_INVALID_RESPONSE"
      | "CONTEXT_TOO_LARGE"
      | "CANCELLED"
      | "DEPENDENCY_UNAVAILABLE",
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "KernelModelError";
  }
}

export interface KernelModelPort {
  capabilities(): KernelModelCapabilities;
  invoke(request: KernelModelRequest, signal: AbortSignal): Promise<KernelModelOutcome>;
}

export interface KernelBuiltContext {
  systemInstructions: string;
  messages: readonly KernelMessage[];
  toolContracts: readonly KernelToolContract[];
  estimatedTokens: number;
  contextDigest: string;
  /** True when the builder rejected or quarantined part of the requested context. */
  sanitized: boolean;
}

export interface KernelContextInput {
  runId: string;
  turn: number;
  objective: string;
  history: readonly KernelMessage[];
  availableTools: readonly string[];
  purpose: string;
}

export interface KernelContextPort {
  build(input: KernelContextInput): Promise<KernelBuiltContext>;
}

export type KernelToolStatus = "COMPLETED" | "DENIED" | "APPROVAL_REQUIRED" | "OUTCOME_UNKNOWN" | "TIMEOUT" | "FAILED" | "CANCELLED";

export interface KernelToolOutcome {
  status: KernelToolStatus;
  resultDigest: string | null;
  resultPreview: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  approval: { approvalId: string; requestDigest: string; expiresAt: string } | null;
  /** Explicit progress signal; never inferred from model text. */
  progress: { completed?: readonly string[]; pending?: readonly string[] } | null;
  retryable: boolean;
}

export interface KernelToolPort {
  request(input: { tool: string; input: unknown; turn: number; approvalId: string | null; signal: AbortSignal }): Promise<KernelToolOutcome>;
}

export interface KernelBudgetReservation {
  status: "RESERVED" | "EXCEEDED" | "UNKNOWN";
  reservationId: string | null;
  reason: string | null;
}

export interface KernelBudgetPort {
  state(): KernelBudgetState;
  reserve(input: { turn: number; category: "TOKENS"; units: number }): KernelBudgetReservation;
  settle(input: { reservationId: string; turn: number; units: number }): { status: "SETTLED" | "UNKNOWN"; consumedUnits: number };
  release(reservationId: string): void;
}

export interface KernelVerification {
  satisfied: boolean;
  reason: string;
  missing: readonly string[];
}

export interface KernelVerificationPort {
  verify(input: { objective: string; answer: string; turns: readonly KernelTurnRecord[] }): Promise<KernelVerification>;
}

export type KernelEventName =
  | "agent.session.created/v1"
  | "agent.turn.started/v1"
  | "agent.context.built/v1"
  | "agent.model.requested/v1"
  | "agent.model.responded/v1"
  | "agent.tool.requested/v1"
  | "agent.tool.completed/v1"
  | "agent.approval.required/v1"
  | "agent.turn.completed/v1"
  | "agent.loop.detected/v1"
  | "agent.budget.exceeded/v1"
  | "agent.session.completed/v1";

export interface KernelEvent {
  name: KernelEventName;
  runId: string;
  sessionId: string;
  turn: number;
  at: string;
  digest: string;
  details: Record<string, string | number | boolean | null>;
}

export interface KernelEventSink {
  emit(event: KernelEvent): void;
}

export interface KernelTurnRecord {
  turn: number;
  state: KernelState;
  status: "COMPLETED" | "FAILED" | "WAITING_APPROVAL" | "DENIED" | "CANCELLED" | "UNKNOWN";
  modelRequestDigest: string;
  modelResponseDigest: string | null;
  providerId: string | null;
  model: string | null;
  usage: KernelModelUsage | null;
  toolName: string | null;
  toolStatus: KernelToolStatus | null;
  toolResultDigest: string | null;
  approvalId: string | null;
  retryable: boolean;
  reconciliationRequired: boolean;
  startedAt: string;
  completedAt: string | null;
}

export interface KernelCheckpoint {
  schemaVersion: 1;
  runId: string;
  sessionId: string;
  turn: number;
  history: readonly KernelMessage[];
  completedObjectives: readonly string[];
  pendingObjectives: readonly string[];
  tokensUsed: number;
  costMicrosUsed: number;
  failures: number;
  toolCallsUsed: number;
  toolSignatures: readonly string[];
  pendingTool: { tool: string; input: unknown; requestDigest: string; approvalId: string; expiresAt: string } | null;
  digest: string;
}

export interface KernelRunInput {
  runId: string;
  sessionId: string;
  objective: string;
  purpose: string;
  systemInstructions: string;
  actorContext: Readonly<Record<string, string | number | boolean | null>>;
  availableTools: readonly string[];
  limits?: Partial<KernelLoopLimits>;
  signal?: AbortSignal;
  resume?: KernelCheckpoint;
  approvalId?: string | null;
  /** Objective items known to be pending before the first turn. */
  pendingObjectives?: readonly string[];
  /**
   * Deterministic first action.  Used when the caller already knows the tool
   * request (for example an explicit user intent); deterministic workflows must
   * not spend a model decision to discover it.
   */
  initialTool?: { tool: string; input: unknown };
}

export interface KernelRunResult {
  runId: string;
  sessionId: string;
  state: KernelState;
  stopCondition: KernelStopCondition;
  reason: string;
  answer: string | null;
  turns: readonly KernelTurnRecord[];
  checkpoint: KernelCheckpoint;
  pendingApproval: { approvalId: string; tool: string; requestDigest: string; expiresAt: string } | null;
  objectives: { completed: readonly string[]; pending: readonly string[] };
  loop: {
    turnsUsed: number;
    toolCallsUsed: number;
    tokensUsed: number;
    costMicrosUsed: number;
    costKnown: boolean;
    failures: number;
    startedAt: string;
    completedAt: string | null;
  };
  outcomeUnknown: boolean;
  sanitizedContext: boolean;
  budgetState: KernelBudgetState;
}

const KERNEL_PORTS = ["clock", "model", "context", "tools", "budget", "events", "verification"] as const;

export interface KernelPorts {
  clock: KernelClock;
  model: KernelModelPort;
  context: KernelContextPort;
  tools: KernelToolPort;
  budget: KernelBudgetPort;
  events: KernelEventSink;
  verification?: KernelVerificationPort;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function kernelDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export class AgentKernel {
  constructor(private readonly ports: KernelPorts) {
    for (const port of KERNEL_PORTS) {
      if (port === "verification") continue;
      if (this.ports[port] === undefined || this.ports[port] === null) throw new Error(`AgentKernel requires the ${port} port`);
    }
  }

  async run(input: KernelRunInput): Promise<KernelRunResult> {
    const limits: KernelLoopLimits = { ...DEFAULT_KERNEL_LIMITS, ...(input.limits ?? {}) };
    const startedAt = this.ports.clock.now();
    const turns: KernelTurnRecord[] = [];
    const completedObjectives = new Set<string>(input.resume?.completedObjectives ?? []);
    const pendingObjectives = new Set<string>(input.resume?.pendingObjectives ?? input.pendingObjectives ?? []);
    const history: KernelMessage[] = [...(input.resume?.history ?? [])];
    const toolSignatures: string[] = [...(input.resume?.toolSignatures ?? [])];
    let tokensUsed = input.resume?.tokensUsed ?? 0;
    let costMicrosUsed = input.resume?.costMicrosUsed ?? 0;
    let costKnown = true;
    let failures = input.resume?.failures ?? 0;
    let toolCallsUsed = input.resume?.toolCallsUsed ?? 0;
    let state: KernelState = "CREATED";
    let pendingTool = input.resume?.pendingTool ?? null;
    let answer: string | null = null;
    let stopCondition: KernelStopCondition = "NO_PROGRESS";
    let reason = "loop-not-started";
    let outcomeUnknown = false;
    let sanitizedContext = false;
    let completedAt: string | null = null;

    const capabilities = this.ports.model.capabilities();
    const mustCallTools = input.availableTools.length > 0;
    if (mustCallTools && !capabilities.toolCalling) {
      state = "FAILED";
      stopCondition = "DEPENDENCY_UNAVAILABLE";
      reason = "MODEL_MISSING_TOOL_CALLING";
    }

    this.emit("agent.session.created/v1", input, 0, { purpose: input.purpose, tools: input.availableTools.length });

    const turnLimit = Math.max(0, limits.maxTurns);
    let turn = input.resume?.turn ?? 0;
    const finish = (
      finalState: KernelState,
      stop: KernelStopCondition,
      message: string,
      finalAnswer: string | null,
      approval: { tool: string; input: unknown; requestDigest: string; approvalId: string; expiresAt: string } | null,
      unknownOutcome: boolean,
      endedAt: string | null
    ): KernelRunResult =>
      this.result(input, finalState, stop, message, finalAnswer, turns, completedObjectives, pendingObjectives, toolSignatures, tokensUsed, costMicrosUsed, costKnown, failures, toolCallsUsed, approval, unknownOutcome, sanitizedContext, startedAt, endedAt, history);

    if (reason !== "MODEL_MISSING_TOOL_CALLING") {
      // A pending approval resumes first: the checkpoint pins the exact tool request.
      if (pendingTool) {
        const resumedTool = pendingTool;
        state = "WAITING_APPROVAL";
        if (input.approvalId === null || input.approvalId === undefined) {
          stopCondition = "WAITING_HUMAN";
          reason = "APPROVAL_PENDING";
          this.emit("agent.approval.required/v1", input, turn, { tool: resumedTool.tool, approvalId: resumedTool.approvalId });
          return finish(state, stopCondition, reason, answer, resumedTool, outcomeUnknown, null);
        }
        const resumed = await this.dispatchTool(input, resumedTool.tool, resumedTool.input, input.approvalId, turn + 1);
        turns.push(resumed.record);
        toolSignatures.push(resumed.signature);
        if (resumed.outcome.status === "COMPLETED" || resumed.outcome.status === "DENIED") {
          pendingTool = null;
          toolCallsUsed += 1;
        }
        if (resumed.outcome.status === "APPROVAL_REQUIRED") {
          pendingTool = this.pendingFrom(resumed.outcome, resumedTool.tool, resumedTool.input);
          state = "WAITING_APPROVAL";
          stopCondition = "WAITING_HUMAN";
          reason = "APPROVAL_PENDING";
          return finish(state, stopCondition, reason, answer, pendingTool, outcomeUnknown, null);
        }
        if (resumed.outcome.status === "DENIED") {
          state = "FAILED";
          stopCondition = "POLICY_DENIED";
          reason = "TOOL_DENIED_AFTER_APPROVAL";
          completedAt = this.nowIso();
          return finish(state, stopCondition, reason, null, null, false, completedAt);
        }
        if (resumed.outcome.status === "OUTCOME_UNKNOWN" || resumed.outcome.status === "TIMEOUT") {
          outcomeUnknown = true;
          state = "FAILED";
          stopCondition = resumed.outcome.status === "TIMEOUT" ? "TIMEOUT" : "ERROR";
          reason = "TOOL_OUTCOME_UNKNOWN";
          completedAt = this.nowIso();
          return finish(state, stopCondition, reason, null, null, outcomeUnknown, completedAt);
        }
        if (resumed.outcome.progress) this.applyProgress(resumed.outcome.progress, completedObjectives, pendingObjectives);
        history.push(this.toolMessage(resumedTool.tool, resumed.outcome));
        pendingTool = null;
      }

      while (true) {
        if (input.signal?.aborted) {
          state = "CANCELLED";
          stopCondition = "CANCELLED";
          reason = "CANCELLED_BEFORE_TURN";
          break;
        }
        if (turn >= turnLimit) {
          state = "FAILED";
          stopCondition = "BUDGET_EXCEEDED";
          reason = "MAX_TURNS";
          break;
        }
        turn += 1;
        const turnStartedAt = this.nowIso();
        const elapsed = this.ports.clock.now() - startedAt;
        if (elapsed > limits.maxWallTimeMs) {
          state = "FAILED";
          stopCondition = "TIMEOUT";
          reason = "MAX_WALL_TIME";
          break;
        }

        state = "OBSERVING";
        this.emit("agent.turn.started/v1", input, turn, { elapsedMs: elapsed });

        if (input.initialTool && turn === (input.resume?.turn ?? 0) + 1) {
          const initial = input.initialTool;
          if (!input.availableTools.includes(initial.tool)) {
            state = "FAILED";
            stopCondition = "POLICY_DENIED";
            reason = "TOOL_NOT_DECLARED";
            break;
          }
          if (toolCallsUsed >= limits.maxToolCalls) {
            state = "FAILED";
            stopCondition = "BUDGET_EXCEEDED";
            reason = "MAX_TOOL_CALLS";
            break;
          }
          const dispatched = await this.dispatchTool(input, initial.tool, initial.input, input.approvalId ?? null, turn);
          toolSignatures.push(dispatched.signature);
          turns.push(dispatched.record);
          if (dispatched.outcome.status === "COMPLETED" || dispatched.outcome.status === "DENIED") toolCallsUsed += 1;
          if (dispatched.outcome.progress) this.applyProgress(dispatched.outcome.progress, completedObjectives, pendingObjectives);
          if (dispatched.outcome.status === "APPROVAL_REQUIRED") {
            const approvalPending = this.pendingFrom(dispatched.outcome, initial.tool, initial.input);
            pendingTool = approvalPending;
            state = "WAITING_APPROVAL";
            stopCondition = "WAITING_HUMAN";
            reason = "APPROVAL_PENDING";
            this.emit("agent.approval.required/v1", input, turn, { tool: initial.tool, approvalId: approvalPending?.approvalId ?? null });
            break;
          }
          if (dispatched.outcome.status === "DENIED") {
            state = "FAILED";
            stopCondition = "POLICY_DENIED";
            reason = "TOOL_DENIED";
            break;
          }
          if (dispatched.outcome.status === "CANCELLED") {
            state = "CANCELLED";
            stopCondition = "CANCELLED";
            reason = "TOOL_CANCELLED";
            break;
          }
          if (dispatched.outcome.status === "OUTCOME_UNKNOWN" || dispatched.outcome.status === "TIMEOUT") {
            outcomeUnknown = true;
            state = "FAILED";
            stopCondition = dispatched.outcome.status === "TIMEOUT" ? "TIMEOUT" : "ERROR";
            reason = "TOOL_OUTCOME_UNKNOWN";
            break;
          }
          if (dispatched.outcome.status === "FAILED") {
            failures += 1;
            if (failures > limits.maxFailures) {
              state = "FAILED";
              stopCondition = "ERROR";
              reason = "MAX_FAILURES";
              break;
            }
          } else {
            history.push(this.toolMessage(initial.tool, dispatched.outcome));
          }
          continue;
        }

        state = "CONTEXT_BUILDING";
        let built: KernelBuiltContext;
        try {
          built = await this.ports.context.build({ runId: input.runId, turn, objective: input.objective, history, availableTools: input.availableTools, purpose: input.purpose });
        } catch (error) {
          const failure = this.recordFailure(turn, turnStartedAt, "CONTEXT_BUILD_FAILED", error instanceof Error ? error.message : "unknown");
          turns.push(failure);
          failures += 1;
          state = "FAILED";
          stopCondition = failures > limits.maxFailures ? "ERROR" : "DEPENDENCY_UNAVAILABLE";
          reason = "CONTEXT_BUILD_FAILED";
          break;
        }
        sanitizedContext = sanitizedContext || built.sanitized;
        this.emit("agent.context.built/v1", input, turn, { estimatedTokens: built.estimatedTokens, digest: built.contextDigest, sanitized: built.sanitized });

        const reserved = this.reserveBudget(turn, built.estimatedTokens + Math.min(capabilities.maxOutput, 1024));
        if (reserved.status === "EXCEEDED") {
          state = "FAILED";
          stopCondition = "BUDGET_EXCEEDED";
          reason = reserved.reason ?? "BUDGET_RESERVATION_DENIED";
          this.emit("agent.budget.exceeded/v1", input, turn, { category: "TOKENS", units: built.estimatedTokens });
          break;
        }
        if (reserved.status === "UNKNOWN") {
          // A reservation that cannot be confirmed must never become an
          // un-budgeted model call.
          state = "FAILED";
          stopCondition = "DEPENDENCY_UNAVAILABLE";
          reason = reserved.reason ?? "BUDGET_RESERVATION_UNKNOWN";
          break;
        }

        const request: KernelModelRequest = {
          systemInstructions: built.systemInstructions,
          messages: built.messages,
          tools: built.toolContracts,
          maxOutputTokens: Math.min(capabilities.maxOutput, 2048),
          purpose: input.purpose,
          contextDigest: built.contextDigest
        };
        const modelRequestDigest = kernelDigest({ ...request, messages: request.messages.map((message) => message.digest ?? kernelDigest(message.content)) });
        state = "MODEL_PENDING";
        this.emit("agent.model.requested/v1", input, turn, { digest: modelRequestDigest, tools: request.tools.length });

        let outcome: KernelModelOutcome;
        try {
          outcome = await this.ports.model.invoke(request, input.signal ?? new AbortController().signal);
        } catch (error) {
          if (reserved.reservationId) this.ports.budget.release(reserved.reservationId);
          if (input.signal?.aborted) {
            state = "CANCELLED";
            stopCondition = "CANCELLED";
            reason = "CANCELLED_DURING_MODEL";
          } else if (error instanceof KernelModelError) {
            failures += 1;
            state = "FAILED";
            if (error.code === "MODEL_TIMEOUT") {
              stopCondition = "TIMEOUT";
              reason = "MODEL_TIMEOUT";
            } else if (error.code === "CONTEXT_TOO_LARGE") {
              stopCondition = "BUDGET_EXCEEDED";
              reason = "CONTEXT_TOO_LARGE";
            } else if (error.code === "MODEL_UNAVAILABLE" || error.code === "DEPENDENCY_UNAVAILABLE") {
              stopCondition = failures > limits.maxFailures ? "DEPENDENCY_UNAVAILABLE" : "ERROR";
              reason = error.code;
            } else {
              stopCondition = error.retryable && failures <= limits.maxFailures ? "ERROR" : "ERROR";
              reason = error.code;
            }
          } else {
            failures += 1;
            state = "FAILED";
            stopCondition = "ERROR";
            reason = "MODEL_INVOCATION_FAILED";
          }
          turns.push({ turn, state, status: "FAILED", modelRequestDigest, modelResponseDigest: null, providerId: null, model: null, usage: null, toolName: null, toolStatus: null, toolResultDigest: null, approvalId: null, retryable: false, reconciliationRequired: false, startedAt: turnStartedAt, completedAt: this.nowIso() });
          break;
        }

        state = "MODEL_COMPLETED";
        tokensUsed += outcome.usage.inputTokens + outcome.usage.outputTokens;
        if (outcome.usage.costMicros === null) costKnown = false;
        else costMicrosUsed += outcome.usage.costMicros;
        const settlement = reserved.reservationId
          ? this.ports.budget.settle({ reservationId: reserved.reservationId, turn, units: outcome.usage.inputTokens + outcome.usage.outputTokens })
          : ({ status: "SETTLED", consumedUnits: outcome.usage.inputTokens + outcome.usage.outputTokens } as const);
        if (settlement.status === "UNKNOWN") outcomeUnknown = true;
        this.emit("agent.model.responded/v1", input, turn, { digest: outcome.responseDigest, inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens, settlement: settlement.status });

        if (outcome.reply.kind === "INVALID_RESPONSE") {
          failures += 1;
          turns.push({ turn, state: "FAILED", status: "FAILED", modelRequestDigest, modelResponseDigest: outcome.responseDigest, providerId: outcome.providerId, model: outcome.model, usage: outcome.usage, toolName: null, toolStatus: null, toolResultDigest: null, approvalId: null, retryable: outcome.retryable, reconciliationRequired: false, startedAt: turnStartedAt, completedAt: this.nowIso() });
          if (failures > limits.maxFailures) {
            state = "FAILED";
            stopCondition = "ERROR";
            reason = "MODEL_INVALID_RESPONSE";
            break;
          }
          history.push({ role: "user", content: "The previous reply was not a valid structured response. Reply with a final message or a valid tool request.", digest: kernelDigest("invalid-response-retry") });
          continue;
        }

        if (this.tokensExceeded(tokensUsed, limits.maxTokens) || this.costExceeded(costKnown, costMicrosUsed, limits.maxCostMicros)) {
          state = "FAILED";
          stopCondition = "BUDGET_EXCEEDED";
          reason = this.tokensExceeded(tokensUsed, limits.maxTokens) ? "MAX_TOKENS" : "MAX_COST";
          turns.push({ turn, state, status: "FAILED", modelRequestDigest, modelResponseDigest: outcome.responseDigest, providerId: outcome.providerId, model: outcome.model, usage: outcome.usage, toolName: null, toolStatus: null, toolResultDigest: null, approvalId: null, retryable: false, reconciliationRequired: false, startedAt: turnStartedAt, completedAt: this.nowIso() });
          this.emit("agent.budget.exceeded/v1", input, turn, { reason, tokensUsed, costMicrosUsed });
          break;
        }

        if (outcome.reply.kind === "MESSAGE") {
          state = "VERIFYING";
          const verification = await this.verify(input.objective, outcome.reply.content, turns, completedObjectives, pendingObjectives);
          answer = outcome.reply.content;
          turns.push({ turn, state: "COMPLETED", status: "COMPLETED", modelRequestDigest, modelResponseDigest: outcome.responseDigest, providerId: outcome.providerId, model: outcome.model, usage: outcome.usage, toolName: null, toolStatus: null, toolResultDigest: null, approvalId: null, retryable: false, reconciliationRequired: false, startedAt: turnStartedAt, completedAt: this.nowIso() });
          this.emit("agent.turn.completed/v1", input, turn, { status: "COMPLETED", verified: verification.satisfied });
          if (!verification.satisfied && verification.missing.length > 0) {
            state = "COMPLETED";
            stopCondition = "WAITING_HUMAN";
            reason = "MISSING_INFORMATION";
            for (const item of verification.missing) pendingObjectives.add(item);
            break;
          }
          state = "COMPLETED";
          stopCondition = "TASK_COMPLETED";
          reason = verification.satisfied ? "TASK_COMPLETED" : verification.reason;
          break;
        }

        // Tool request
        const toolName = outcome.reply.tool;
        if (!input.availableTools.includes(toolName)) {
          turns.push({ turn, state: "FAILED", status: "DENIED", modelRequestDigest, modelResponseDigest: outcome.responseDigest, providerId: outcome.providerId, model: outcome.model, usage: outcome.usage, toolName, toolStatus: "DENIED", toolResultDigest: null, approvalId: null, retryable: false, reconciliationRequired: false, startedAt: turnStartedAt, completedAt: this.nowIso() });
          state = "FAILED";
          stopCondition = "POLICY_DENIED";
          reason = "TOOL_NOT_DECLARED";
          break;
        }
        if (toolCallsUsed >= limits.maxToolCalls) {
          turns.push({ turn, state: "FAILED", status: "FAILED", modelRequestDigest, modelResponseDigest: outcome.responseDigest, providerId: outcome.providerId, model: outcome.model, usage: outcome.usage, toolName, toolStatus: "FAILED", toolResultDigest: null, approvalId: null, retryable: false, reconciliationRequired: false, startedAt: turnStartedAt, completedAt: this.nowIso() });
          state = "FAILED";
          stopCondition = "BUDGET_EXCEEDED";
          reason = "MAX_TOOL_CALLS";
          break;
        }
        const dispatched = await this.dispatchTool(input, toolName, outcome.reply.input, input.approvalId ?? null, turn, outcome);
        toolSignatures.push(dispatched.signature);
        turns.push(dispatched.record);
        if (dispatched.outcome.status === "COMPLETED" || dispatched.outcome.status === "DENIED") toolCallsUsed += 1;
        if (this.loopDetected(toolSignatures, limits)) {
          state = "FAILED";
          stopCondition = "NO_PROGRESS";
          reason = "LOOP_DETECTED";
          this.emit("agent.loop.detected/v1", input, turn, { tool: toolName, repetitions: limits.maxRepeatedToolCalls ?? 2 });
          break;
        }
        if (dispatched.outcome.progress) this.applyProgress(dispatched.outcome.progress, completedObjectives, pendingObjectives);
        if (dispatched.outcome.status === "APPROVAL_REQUIRED") {
          const approvalPending = this.pendingFrom(dispatched.outcome, toolName, outcome.reply.input);
          pendingTool = approvalPending;
          state = "WAITING_APPROVAL";
          stopCondition = "WAITING_HUMAN";
          reason = "APPROVAL_PENDING";
          this.emit("agent.approval.required/v1", input, turn, { tool: toolName, approvalId: approvalPending?.approvalId ?? null });
          break;
        }
        if (dispatched.outcome.status === "DENIED") {
          state = "FAILED";
          stopCondition = "POLICY_DENIED";
          reason = "TOOL_DENIED";
          break;
        }
        if (dispatched.outcome.status === "CANCELLED") {
          state = "CANCELLED";
          stopCondition = "CANCELLED";
          reason = "TOOL_CANCELLED";
          break;
        }
        if (dispatched.outcome.status === "OUTCOME_UNKNOWN" || dispatched.outcome.status === "TIMEOUT") {
          outcomeUnknown = true;
          state = "FAILED";
          stopCondition = dispatched.outcome.status === "TIMEOUT" ? "TIMEOUT" : "ERROR";
          reason = "TOOL_OUTCOME_UNKNOWN";
          break;
        }
        if (dispatched.outcome.status === "FAILED") {
          failures += 1;
          history.push({ role: "user", content: `The tool ${toolName} failed with ${dispatched.outcome.errorCode ?? "UNKNOWN"}. Do not retry blindly.`, digest: kernelDigest(dispatched.outcome.errorCode ?? "unknown") });
          if (failures > limits.maxFailures) {
            state = "FAILED";
            stopCondition = "ERROR";
            reason = "MAX_FAILURES";
            break;
          }
          continue;
        }
        history.push(this.toolMessage(toolName, dispatched.outcome));
      }
    }

    completedAt = completedAt ?? this.nowIso();
    const finalState: KernelState = state === "CREATED" ? "FAILED" : state;
    this.emit("agent.session.completed/v1", input, turn, { stopCondition, reason });
    return finish(finalState, stopCondition, reason, answer, pendingTool, outcomeUnknown, completedAt);
  }

  private async dispatchTool(
    input: KernelRunInput,
    tool: string,
    toolInput: unknown,
    approvalId: string | null,
    turn: number,
    modelOutcome?: KernelModelOutcome
  ): Promise<{ record: KernelTurnRecord; outcome: KernelToolOutcome; signature: string }> {
    const startedAt = this.nowIso();
    const signature = `${tool}:${kernelDigest(toolInput)}`;
    this.emit("agent.tool.requested/v1", input, turn, { tool, digest: kernelDigest(toolInput) });
    let outcome: KernelToolOutcome;
    try {
      outcome = await this.ports.tools.request({ tool, input: toolInput, turn, approvalId, signal: input.signal ?? new AbortController().signal });
    } catch (error) {
      outcome = {
        status: input.signal?.aborted ? "CANCELLED" : "FAILED",
        resultDigest: null,
        resultPreview: null,
        errorCode: "TOOL_PORT_FAILURE",
        errorMessage: error instanceof Error ? error.message : "unknown tool port failure",
        approval: null,
        progress: null,
        retryable: false
      };
    }
    this.emit("agent.tool.completed/v1", input, turn, { tool, status: outcome.status, digest: outcome.resultDigest, approvalId: outcome.approval?.approvalId ?? null });
    const record: KernelTurnRecord = {
      turn,
      state: outcome.status === "APPROVAL_REQUIRED" ? "WAITING_APPROVAL" : "TOOL_COMPLETED",
      status: outcome.status === "COMPLETED" ? "COMPLETED" : outcome.status === "DENIED" ? "DENIED" : outcome.status === "APPROVAL_REQUIRED" ? "WAITING_APPROVAL" : outcome.status === "CANCELLED" ? "CANCELLED" : outcome.status === "OUTCOME_UNKNOWN" || outcome.status === "TIMEOUT" ? "UNKNOWN" : "FAILED",
      modelRequestDigest: modelOutcome ? kernelDigest({ providerId: modelOutcome.providerId, reply: modelOutcome.reply.kind }) : kernelDigest({ resumedTool: tool }),
      modelResponseDigest: modelOutcome?.responseDigest ?? null,
      providerId: modelOutcome?.providerId ?? null,
      model: modelOutcome?.model ?? null,
      usage: modelOutcome?.usage ?? null,
      toolName: tool,
      toolStatus: outcome.status,
      toolResultDigest: outcome.resultDigest,
      approvalId: outcome.approval?.approvalId ?? approvalId,
      retryable: outcome.retryable && outcome.status !== "OUTCOME_UNKNOWN" && outcome.status !== "TIMEOUT",
      reconciliationRequired: outcome.status === "OUTCOME_UNKNOWN" || outcome.status === "TIMEOUT",
      startedAt,
      completedAt: this.nowIso()
    };
    // The repetition budget is enforced by the caller after the signature lands.
    return { record, outcome, signature };
  }

  private toolMessage(toolName: string, outcome: KernelToolOutcome): KernelMessage {
    const message: KernelMessage = { role: "tool", content: outcome.resultPreview ?? "" };
    if (outcome.resultDigest !== null) message.digest = outcome.resultDigest;
    if (toolName.length > 0) message.toolName = toolName;
    return message;
  }

  private applyProgress(
    progress: { completed?: readonly string[]; pending?: readonly string[] },
    completed: Set<string>,
    pending: Set<string>
  ): void {
    for (const item of progress.completed ?? []) {
      completed.add(item);
      pending.delete(item);
    }
    for (const item of progress.pending ?? []) {
      if (!completed.has(item)) pending.add(item);
    }
  }

  private loopDetected(signatures: readonly string[], limits: KernelLoopLimits): boolean {
    const threshold = Math.max(1, limits.maxRepeatedToolCalls ?? 2);
    if (signatures.length <= threshold) return false;
    const tail = signatures.slice(-threshold - 1);
    const candidate = tail[0];
    return tail.every((signature) => signature === candidate);
  }

  private async verify(
    objective: string,
    answer: string,
    turns: readonly KernelTurnRecord[],
    completed: ReadonlySet<string>,
    pending: ReadonlySet<string>
  ): Promise<KernelVerification> {
    if (pending.size > 0) return { satisfied: false, reason: "PENDING_OBJECTIVES", missing: [...pending] };
    if (this.ports.verification) return this.ports.verification.verify({ objective, answer, turns });
    return { satisfied: true, reason: "DEFAULT_ACCEPT", missing: [] };
  }

  private reserveBudget(turn: number, units: number): KernelBudgetReservation {
    try {
      return this.ports.budget.reserve({ turn, category: "TOKENS", units });
    } catch {
      return { status: "UNKNOWN", reservationId: null, reason: "BUDGET_PORT_FAILURE" };
    }
  }

  private tokensExceeded(tokensUsed: number, maxTokens: number): boolean {
    return tokensUsed > maxTokens;
  }

  private costExceeded(costKnown: boolean, costMicrosUsed: number, maxCostMicros: number | null): boolean {
    return costKnown && maxCostMicros !== null && costMicrosUsed > maxCostMicros;
  }

  private pendingFrom(
    outcome: KernelToolOutcome,
    tool: string,
    toolInput: unknown
  ): { tool: string; input: unknown; requestDigest: string; approvalId: string; expiresAt: string } | null {
    if (!outcome.approval) return null;
    return { tool, input: toolInput, requestDigest: outcome.approval.requestDigest, approvalId: outcome.approval.approvalId, expiresAt: outcome.approval.expiresAt };
  }

  private recordFailure(turn: number, startedAt: string, code: string, message: string): KernelTurnRecord {
    return { turn, state: "FAILED", status: "FAILED", modelRequestDigest: kernelDigest({ code }), modelResponseDigest: null, providerId: null, model: null, usage: null, toolName: null, toolStatus: null, toolResultDigest: null, approvalId: null, retryable: false, reconciliationRequired: false, startedAt, completedAt: this.nowIso() };
  }

  private emit(name: KernelEventName, input: KernelRunInput, turn: number, details: KernelEvent["details"]): void {
    const event: KernelEvent = { name, runId: input.runId, sessionId: input.sessionId, turn, at: this.nowIso(), digest: kernelDigest({ name, turn, details }), details };
    this.ports.events.emit(event);
  }

  private nowIso(): string {
    return new Date(this.ports.clock.now()).toISOString();
  }

  private result(
    input: KernelRunInput,
    state: KernelState,
    stopCondition: KernelStopCondition,
    reason: string,
    answer: string | null,
    turns: KernelTurnRecord[],
    completed: Set<string>,
    pending: Set<string>,
    toolSignatures: string[],
    tokensUsed: number,
    costMicrosUsed: number,
    costKnown: boolean,
    failures: number,
    toolCallsUsed: number,
    pendingTool: { tool: string; input: unknown; requestDigest: string; approvalId: string; expiresAt: string } | null,
    outcomeUnknown: boolean,
    sanitizedContext: boolean,
    startedAt: number,
    completedAt: string | null,
    history: readonly KernelMessage[]
  ): KernelRunResult {
    // Checkpoints keep digests, never raw content: sensitive payloads stay in the
    // governed session store, not in the resumable checkpoint.
    const boundedHistory: KernelMessage[] = history.slice(-32).map((message) => {
      const entry: KernelMessage = { role: message.role, content: "", digest: message.digest ?? kernelDigest(message.content) };
      if (message.toolName !== undefined) entry.toolName = message.toolName;
      return entry;
    });
    const checkpointBase = {
      schemaVersion: 1 as const,
      runId: input.runId,
      sessionId: input.sessionId,
      turn: turns.at(-1)?.turn ?? input.resume?.turn ?? 0,
      history: boundedHistory,
      completedObjectives: [...completed],
      pendingObjectives: [...pending],
      tokensUsed,
      costMicrosUsed,
      failures,
      toolCallsUsed,
      toolSignatures,
      pendingTool
    };
    const checkpoint: KernelCheckpoint = { ...checkpointBase, digest: kernelDigest(checkpointBase) };
    return {
      runId: input.runId,
      sessionId: input.sessionId,
      state,
      stopCondition,
      reason,
      answer,
      turns,
      checkpoint,
      pendingApproval: pendingTool ? { approvalId: pendingTool.approvalId, tool: pendingTool.tool, requestDigest: pendingTool.requestDigest, expiresAt: pendingTool.expiresAt } : null,
      objectives: { completed: [...completed], pending: [...pending] },
      loop: { turnsUsed: turns.at(-1)?.turn ?? 0, toolCallsUsed, tokensUsed, costMicrosUsed, costKnown, failures, startedAt: new Date(startedAt).toISOString(), completedAt },
      outcomeUnknown,
      sanitizedContext,
      budgetState: this.safeBudgetState()
    };
  }

  private safeBudgetState(): KernelBudgetState {
    try {
      return this.ports.budget.state();
    } catch {
      return "UNKNOWN";
    }
  }
}
