import test from "node:test";
import assert from "node:assert/strict";
import {
  AgentKernel,
  DEFAULT_KERNEL_LIMITS,
  KernelModelError,
  kernelDigest,
  type KernelBudgetState,
  type KernelBuiltContext,
  type KernelEvent,
  type KernelModelCapabilities,
  type KernelModelOutcome,
  type KernelModelPort,
  type KernelModelRequest,
  type KernelRunInput,
  type KernelToolOutcome,
  type KernelToolPort,
  type KernelVerificationPort
} from "@cvg/agent-kernel";

type ModelStep = KernelModelOutcome | KernelModelError | ((request: KernelModelRequest) => KernelModelOutcome | KernelModelError);
type ToolStep = KernelToolOutcome | ((tool: string, input: unknown) => KernelToolOutcome);

function message(content: string): KernelModelOutcome {
  return { reply: { kind: "MESSAGE", content }, usage: { inputTokens: 10, outputTokens: 5, costMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC" }, providerId: "mock", model: "mock-1", responseDigest: kernelDigest(content), retryable: false };
}

function toolRequest(tool: string, input: unknown): KernelModelOutcome {
  return { reply: { kind: "TOOL_REQUEST", tool, input, rationale: null }, usage: { inputTokens: 8, outputTokens: 4, costMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC" }, providerId: "mock", model: "mock-1", responseDigest: kernelDigest({ tool, input }), retryable: false };
}

function completedTool(preview = "ok"): KernelToolOutcome {
  return { status: "COMPLETED", resultDigest: kernelDigest(preview), resultPreview: preview, errorCode: null, errorMessage: null, approval: null, progress: null, retryable: false };
}

function approvalNeeded(): KernelToolOutcome {
  return { status: "APPROVAL_REQUIRED", resultDigest: null, resultPreview: null, errorCode: null, errorMessage: null, approval: { approvalId: "approval-1", requestDigest: kernelDigest("approval"), expiresAt: new Date(Date.now() + 60_000).toISOString() }, progress: null, retryable: false };
}

function buildKernel(options: {
  model: ModelStep[];
  tools?: ToolStep[];
  budget?: { capTokens: number; capCostMicros?: number | null };
  now?: () => number;
  verification?: KernelVerificationPort;
  contextThrows?: boolean;
}) {
  const events: KernelEvent[] = [];
  const modelRequests: KernelModelRequest[] = [];
  let modelIndex = 0;
  let toolIndex = 0;
  let tokensReserved = 0;
  let settled = 0;
  let budgetState: KernelBudgetState = "AVAILABLE";
  const clock: { value: number; now(): number } = { value: 1_000_000, now: () => clock.value };
  if (options.now) clock.now = options.now;

  const model: KernelModelPort = {
    capabilities(): KernelModelCapabilities {
      return { toolCalling: true, structuredOutput: true, streaming: false, reasoning: false, vision: false, contextWindow: 100_000, maxOutput: 4_096 };
    },
    async invoke(request): Promise<KernelModelOutcome> {
      modelRequests.push(request);
      const step: ModelStep | undefined = options.model[Math.min(modelIndex, options.model.length - 1)];
      modelIndex += 1;
      if (!step) throw new KernelModelError("MODEL_UNAVAILABLE", "no scripted response", true);
      if (step instanceof KernelModelError) throw step;
      if (typeof step === "function") return step(request) as KernelModelOutcome;
      return step as KernelModelOutcome;
    }
  };

  const tools: KernelToolPort = {
    async request({ tool }): Promise<KernelToolOutcome> {
      const step = options.tools?.[Math.min(toolIndex, (options.tools?.length ?? 1) - 1)];
      toolIndex += 1;
      if (!step) return completedTool(`tool:${tool}`);
      if (typeof step === "function") return step(tool, null);
      return step;
    }
  };

  const kernel = new AgentKernel({
    clock,
    model,
    context: {
      async build(): Promise<KernelBuiltContext> {
        if (options.contextThrows) throw new Error("context unavailable");
        return {
          systemInstructions: "system",
          messages: [{ role: "user", content: "objective" }],
          toolContracts: [{ name: "cvg.patient.read", version: "1.0.0", description: "read", risk: "READ_ONLY", inputSchemaDigest: kernelDigest("schema") }],
          estimatedTokens: 100,
          contextDigest: kernelDigest("context"),
          sanitized: false
        };
      }
    },
    tools,
    budget: {
      state: () => budgetState,
      reserve: ({ units }) => {
        const cap = options.budget?.capTokens ?? 1_000_000;
        if (tokensReserved + units > cap) {
          budgetState = "EXCEEDED";
          return { status: "EXCEEDED", reservationId: null, reason: "RESERVATION_DENIED" };
        }
        tokensReserved += units;
        budgetState = "RESERVED";
        return { status: "RESERVED", reservationId: `res-${tokensReserved}`, reason: null };
      },
      settle: ({ units, reservationId }) => {
        settled += units;
        budgetState = "SETTLED";
        return { status: "SETTLED", consumedUnits: units + (reservationId.length > 0 ? 0 : 0) };
      },
      release: () => {
        budgetState = "AVAILABLE";
      }
    },
    events: { emit: (event) => events.push(event) },
    ...(options.verification ? { verification: options.verification } : {})
  });

  return { kernel, events, modelRequests, clock, get settledTokens() { return settled; } };
}

function input(overrides: Partial<KernelRunInput> = {}): KernelRunInput {
  return {
    runId: "run-1",
    sessionId: "session-1",
    objective: "confirm appointment",
    purpose: "OPERATIONS",
    systemInstructions: "governed",
    actorContext: { organizationId: "org-1" },
    availableTools: ["cvg.patient.read"],
    ...overrides
  };
}

test("kernel completes a normal message turn", async () => {
  const { kernel, events } = buildKernel({ model: [message("done")] });
  const result = await kernel.run(input());
  assert.equal(result.stopCondition, "TASK_COMPLETED");
  assert.equal(result.answer, "done");
  assert.equal(result.turns.length, 1);
  assert.equal(result.loop.turnsUsed, 1);
  assert.ok(events.some((event) => event.name === "agent.session.created/v1"));
  assert.ok(events.some((event) => event.name === "agent.session.completed/v1"));
});

test("kernel executes a tool and then completes", async () => {
  const { kernel, events } = buildKernel({ model: [toolRequest("cvg.patient.read", { id: "p1" }), message("confirmed")], tools: [completedTool("patient")] });
  const result = await kernel.run(input());
  assert.equal(result.stopCondition, "TASK_COMPLETED");
  assert.equal(result.answer, "confirmed");
  assert.equal(result.loop.toolCallsUsed, 1);
  assert.ok(result.turns.some((turn) => turn.toolName === "cvg.patient.read" && turn.toolStatus === "COMPLETED"));
  assert.ok(events.some((event) => event.name === "agent.tool.requested/v1"));
  assert.ok(events.some((event) => event.name === "agent.tool.completed/v1"));
});

test("kernel pauses on approval and resumes with the exact checkpoint", async () => {
  const first = buildKernel({ model: [toolRequest("cvg.patient.read", { id: "p1" })], tools: [approvalNeeded()] });
  const paused = await first.kernel.run(input());
  assert.equal(paused.stopCondition, "WAITING_HUMAN");
  assert.equal(paused.state, "WAITING_APPROVAL");
  assert.ok(paused.pendingApproval);
  assert.equal(paused.pendingApproval?.tool, "cvg.patient.read");
  assert.equal(paused.pendingApproval?.approvalId, "approval-1");

  const second = buildKernel({ model: [message("after approval")], tools: [completedTool("granted")] });
  const resumed = await second.kernel.run(input({ resume: paused.checkpoint, approvalId: "approval-1" }));
  assert.equal(resumed.stopCondition, "TASK_COMPLETED");
  assert.equal(resumed.answer, "after approval");
  assert.equal(second.events.filter((event) => event.name === "agent.tool.requested/v1").length, 1);
});

test("kernel keeps waiting when the checkpoint is resumed without an approval id", async () => {
  const first = buildKernel({ model: [toolRequest("cvg.patient.read", { id: "p1" })], tools: [approvalNeeded()] });
  const paused = await first.kernel.run(input());
  const second = buildKernel({ model: [message("should not run")] });
  const waiting = await second.kernel.run(input({ resume: paused.checkpoint, approvalId: null }));
  assert.equal(waiting.stopCondition, "WAITING_HUMAN");
  assert.equal(second.modelRequests.length, 0);
});

test("kernel denies a tool that was not declared and audits the decision", async () => {
  const { kernel } = buildKernel({ model: [toolRequest("cvg.finance.refund", {})] });
  const result = await kernel.run(input(),
  );
  assert.equal(result.stopCondition, "POLICY_DENIED");
  assert.equal(result.reason, "TOOL_NOT_DECLARED");
});

test("kernel denies a tool rejected by the gateway", async () => {
  const denied: KernelToolOutcome = { status: "DENIED", resultDigest: null, resultPreview: null, errorCode: "POLICY_DENIED", errorMessage: "denied", approval: null, progress: null, retryable: false };
  const { kernel } = buildKernel({ model: [toolRequest("cvg.patient.read", {})], tools: [denied] });
  const result = await kernel.run(input());
  assert.equal(result.stopCondition, "POLICY_DENIED");
  assert.equal(result.reason, "TOOL_DENIED");
});

test("kernel stops on max turns", async () => {
  const { kernel } = buildKernel({ model: [toolRequest("cvg.patient.read", { seq: 1 }), toolRequest("cvg.patient.read", { seq: 2 }), toolRequest("cvg.patient.read", { seq: 3 })], tools: [completedTool()] });
  const result = await kernel.run(input({ limits: { maxTurns: 2, maxRepeatedToolCalls: 99 } }));
  assert.equal(result.stopCondition, "BUDGET_EXCEEDED");
  assert.equal(result.reason, "MAX_TURNS");
  assert.equal(result.loop.turnsUsed, 2);
});

test("kernel stops on token exhaustion", async () => {
  const { kernel } = buildKernel({ model: [message("huge")] });
  const result = await kernel.run(input({ limits: { maxTokens: 1, maxRepeatedToolCalls: 99 } }));
  assert.equal(result.stopCondition, "BUDGET_EXCEEDED");
  assert.equal(result.reason, "MAX_TOKENS");
});

test("kernel stops on cost exhaustion when the cost is known", async () => {
  const costly: KernelModelOutcome = { reply: { kind: "MESSAGE", content: "costly" }, usage: { inputTokens: 10, outputTokens: 5, costMicros: 900, currency: "USD", source: "PROVIDER" }, providerId: "deepseek", model: "deepseek-v4-flash", responseDigest: kernelDigest("costly"), retryable: false };
  const { kernel } = buildKernel({ model: [costly] });
  const result = await kernel.run(input({ limits: { maxCostMicros: 100, maxTokens: 1_000_000 } }));
  assert.equal(result.stopCondition, "BUDGET_EXCEEDED");
  assert.equal(result.reason, "MAX_COST");
});

test("kernel stops when the budget reservation cannot be confirmed", async () => {
  const { kernel, modelRequests } = buildKernel({ model: [message("never")] });
  const failing = new AgentKernel({
    clock: { now: () => 1_000_000 },
    model: { capabilities: () => ({ toolCalling: true, structuredOutput: true, streaming: false, reasoning: false, vision: false, contextWindow: 10_000, maxOutput: 1_000 }), invoke: async () => message("never") },
    context: {
      async build() {
        return { systemInstructions: "s", messages: [], toolContracts: [], estimatedTokens: 10, contextDigest: kernelDigest("c"), sanitized: false };
      }
    },
    tools: { async request() { return completedTool(); } },
    budget: {
      state: () => "UNKNOWN",
      reserve: () => ({ status: "UNKNOWN", reservationId: null, reason: "BUDGET_PORT_FAILURE" }),
      settle: () => ({ status: "UNKNOWN", consumedUnits: 0 }),
      release: () => undefined
    },
    events: { emit: () => undefined }
  });
  const result = await failing.run(input());
  assert.equal(result.stopCondition, "DEPENDENCY_UNAVAILABLE");
  assert.equal(result.reason, "BUDGET_PORT_FAILURE");
  assert.equal(result.turns.length, 0);
  void kernel;
  void modelRequests;
});

test("kernel keeps unknown cost explicit instead of assuming zero", async () => {
  const unknown: KernelModelOutcome = { reply: { kind: "MESSAGE", content: "ok" }, usage: { inputTokens: 10, outputTokens: 5, costMicros: null, currency: null, source: "UNAVAILABLE" }, providerId: "deepseek", model: "deepseek-v4-flash", responseDigest: kernelDigest("ok"), retryable: false };
  const { kernel } = buildKernel({ model: [unknown] });
  const result = await kernel.run(input({ limits: { maxCostMicros: 1 } }));
  assert.equal(result.stopCondition, "TASK_COMPLETED");
  assert.equal(result.loop.costKnown, false);
});

test("kernel maps a model timeout to TIMEOUT", async () => {
  const { kernel } = buildKernel({ model: [new KernelModelError("MODEL_TIMEOUT", "timed out", true)] });
  const result = await kernel.run(input());
  assert.equal(result.stopCondition, "TIMEOUT");
  assert.equal(result.reason, "MODEL_TIMEOUT");
});

test("kernel reports dependency unavailable after exhausting failures", async () => {
  const { kernel } = buildKernel({ model: [new KernelModelError("MODEL_UNAVAILABLE", "down", true)] });
  const result = await kernel.run(input({ limits: { maxFailures: 1, maxTurns: 4 } }));
  assert.equal(result.state, "FAILED");
  assert.ok(["ERROR", "DEPENDENCY_UNAVAILABLE"].includes(result.stopCondition));
  assert.equal(result.reason, "MODEL_UNAVAILABLE");
});

test("kernel cancels before the first turn when the signal is aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const { kernel } = buildKernel({ model: [message("never")] });
  const result = await kernel.run(input({ signal: controller.signal }));
  assert.equal(result.stopCondition, "CANCELLED");
  assert.equal(result.state, "CANCELLED");
});

test("kernel retries an invalid structured response within the failure budget", async () => {
  const invalid: KernelModelOutcome = { reply: { kind: "INVALID_RESPONSE", reason: "bad json" }, usage: { inputTokens: 4, outputTokens: 2, costMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC" }, providerId: "mock", model: "mock-1", responseDigest: kernelDigest("invalid"), retryable: true };
  const { kernel } = buildKernel({ model: [invalid, message("recovered")] });
  const result = await kernel.run(input({ limits: { maxFailures: 2 } }));
  assert.equal(result.stopCondition, "TASK_COMPLETED");
  assert.equal(result.answer, "recovered");
});

test("kernel detects a runaway tool loop with no progress", async () => {
  const { kernel, events } = buildKernel({ model: [toolRequest("cvg.patient.read", { same: true })], tools: [completedTool()], });
  const result = await kernel.run(input({ limits: { maxRepeatedToolCalls: 2, maxTurns: 10, maxToolCalls: 10 } }));
  assert.equal(result.stopCondition, "NO_PROGRESS");
  assert.equal(result.reason, "LOOP_DETECTED");
  assert.ok(events.some((event) => event.name === "agent.loop.detected/v1"));
});

test("kernel stops on context build failure without corrupting state", async () => {
  const { kernel } = buildKernel({ model: [message("never")], contextThrows: true });
  const result = await kernel.run(input());
  assert.equal(result.reason, "CONTEXT_BUILD_FAILED");
  assert.ok(["ERROR", "DEPENDENCY_UNAVAILABLE"].includes(result.stopCondition));
  assert.equal(result.answer, null);
});

test("kernel returns WAITING_HUMAN with missing information instead of guessing", async () => {
  const verification: KernelVerificationPort = {
    async verify() {
      return { satisfied: false, reason: "MISSING_INFORMATION", missing: ["guardian phone"] };
    }
  };
  const { kernel } = buildKernel({ model: [message("maybe")], verification });
  const result = await kernel.run(input());
  assert.equal(result.stopCondition, "WAITING_HUMAN");
  assert.equal(result.reason, "MISSING_INFORMATION");
  assert.deepEqual(result.objectives.pending, ["guardian phone"]);
});

test("kernel records progress from the tool port, not from model text", async () => {
  const progressTool: KernelToolOutcome = { status: "COMPLETED", resultDigest: kernelDigest("p"), resultPreview: "p", errorCode: null, errorMessage: null, approval: null, progress: { completed: ["patient-identified"], pending: ["confirm-slot"] }, retryable: false };
  const { kernel } = buildKernel({ model: [toolRequest("cvg.patient.read", { id: "p1" }), message("ok")], tools: [progressTool] });
  const result = await kernel.run(input());
  assert.deepEqual(result.objectives.completed, ["patient-identified"]);
  assert.deepEqual(result.objectives.pending, ["confirm-slot"]);
});

test("kernel reports OUTCOME_UNKNOWN instead of retrying a tool with unknown outcome", async () => {
  const unknown: KernelToolOutcome = { status: "OUTCOME_UNKNOWN", resultDigest: null, resultPreview: null, errorCode: "TOOL_OUTCOME_UNKNOWN", errorMessage: "lost", approval: null, progress: null, retryable: false };
  const { kernel } = buildKernel({ model: [toolRequest("cvg.patient.read", {})], tools: [unknown] });
  const result = await kernel.run(input());
  assert.equal(result.outcomeUnknown, true);
  assert.equal(result.reason, "TOOL_OUTCOME_UNKNOWN");
  assert.equal(result.stopCondition, "ERROR");
});

test("kernel dispatches a deterministic initial tool without spending a model decision", async () => {
  const { kernel, modelRequests } = buildKernel({ model: [message("done after initial tool")], tools: [completedTool("initial")] });
  const result = await kernel.run(input({ initialTool: { tool: "cvg.patient.read", input: { id: "p1" } } }));
  assert.equal(result.stopCondition, "TASK_COMPLETED");
  assert.equal(result.loop.toolCallsUsed, 1);
  assert.equal(result.answer, "done after initial tool");
  assert.equal(modelRequests.length, 1);
  assert.equal(result.turns[0]?.toolName, "cvg.patient.read");
});

test("kernel checkpoints keep digests, not raw content, and enforce the default limits", async () => {
  const { kernel } = buildKernel({ model: [message("sensitive answer")] });
  const result = await kernel.run(input());
  for (const message of result.checkpoint.history) assert.equal(message.content, "");
  assert.equal(DEFAULT_KERNEL_LIMITS.maxTurns > 0, true);
  assert.equal(result.checkpoint.pendingTool, null);
  assert.equal(result.checkpoint.schemaVersion, 1);
  assert.equal(result.checkpoint.digest.length, 64);
});
