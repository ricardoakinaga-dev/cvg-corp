import { mkdirSync, writeFileSync } from "node:fs";
import { CvgStore, digest } from "@cvg/domain";
import type { CvgContext } from "@cvg/contracts";
import { EmbeddedAgentRuntime } from "@cvg/embedded-agent-runtime";
import { MemoryAgentSessionStore } from "@cvg/agent-session";
import { MockModelProvider, type MockModelStep } from "@cvg/model-adapters";
import { ToolGatewayError } from "@cvg/agent-tools";
import { KernelModelError } from "@cvg/agent-kernel";

/**
 * Local chaos/fault matrix for the embedded agent runtime.  Every fault must
 * leave the domain intact, never duplicate an external effect and never blind
 * retry an unknown outcome.  No external provider is contacted.
 */

const DIGEST = "a".repeat(64);
const failures: string[] = [];
const results: { fault: string; observed: string; invariant: string }[] = [];

function context(store: CvgStore): CvgContext {
  const veterinarianId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id ?? store.bootstrapCredentials.userId;
  const option = store.contextOptions(veterinarianId)[0];
  if (!option) throw new Error("chaos matrix requires a context option");
  const session = store.createSession(veterinarianId, "agent-chaos-token", "agent-chaos-csrf", 60);
  return store.resolveContext(veterinarianId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "chaos", "agent-chaos", null, null, session.id);
}

function message(content: string): MockModelStep {
  return { reply: { kind: "MESSAGE", content }, usage: { inputTokens: 5, outputTokens: 3, costMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC" }, providerId: "mock-model", model: "mock-1", responseDigest: DIGEST, finishReason: "stop", providerRequestId: "chaos", retryable: false };
}

function toolCall(tool: string, input: unknown): MockModelStep {
  return { reply: { kind: "TOOL_CALL", tool, input, callId: "chaos-call" }, usage: { inputTokens: 4, outputTokens: 2, costMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC" }, providerId: "mock-model", model: "mock-1", responseDigest: DIGEST, finishReason: "tool_calls", providerRequestId: "chaos", retryable: false };
}

function record(fault: string, observed: string): void {
  results.push({ fault, observed, invariant: "domain intact · no duplicated effect" });
}

/** Business-domain projection: AI runtime state may change, the hospital data must not. */
function businessDigest(store: CvgStore): string {
  return digest({
    patients: [...store.patients.values()].map((patient) => patient.id).sort(),
    appointments: [...store.appointments.values()].map((appointment) => appointment.id).sort(),
    encounters: [...store.encounters.values()].map((encounter) => encounter.id).sort(),
    clinicalDocuments: [...store.clinicalDocuments.values()].map((document) => document.id).sort(),
    stockMovements: [...store.stockMovements.values()].map((movement) => movement.id).sort(),
    charges: [...store.charges.values()].map((charge) => charge.id).sort(),
    messages: [...store.messages.values()].map((message) => message.id).sort()
  }).slice(0, 16);
}

async function expectNoSuccessfulReceipt(store: CvgStore, label: string): Promise<void> {
  const succeeded = [...store.commandReceipts.values()].filter((receipt) => receipt.operation.startsWith("tool.") && receipt.status === "SUCCEEDED");
  if (succeeded.length > 0) failures.push(`${label}: unexpected successful tool receipt`);
}

async function main(): Promise<void> {
  // Fault 1: model provider unavailable.
  {
    const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
    const ctx = context(store);
    const revision = businessDigest(store);
    const runtime = new EmbeddedAgentRuntime({ store, modelProvider: new MockModelProvider({ unavailable: true }), instanceId: "chaos-1", runtimeCommit: "chaos" });
    const result = await runtime.executeTurn(ctx, { sessionId: null, prompt: "provider down", purpose: "SUMMARY", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "chaos-provider-1" });
    if (result.turn.status !== "OUTCOME_UNKNOWN") failures.push(`provider-down: expected OUTCOME_UNKNOWN, observed ${result.turn.status}`);
    await expectNoSuccessfulReceipt(store, "provider-down");
    if (businessDigest(store) !== revision) failures.push("provider-down: business domain changed");
    record("model provider down", `turn=${result.turn.status}`);
    await runtime.shutdown();
  }

  // Fault 2: model timeout.
  {
    const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
    const ctx = context(store);
    const runtime = new EmbeddedAgentRuntime({
      store,
      modelProvider: new MockModelProvider({
        script: [() => { throw new KernelModelError("MODEL_TIMEOUT", "chaos timeout", true); }],
      }),
      instanceId: "chaos-2",
      runtimeCommit: "chaos"
    });
    const result = await runtime.executeTurn(ctx, { sessionId: null, prompt: "timeout", purpose: "SUMMARY", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "chaos-timeout-1" });
    if (result.turn.status !== "OUTCOME_UNKNOWN") failures.push(`model-timeout: expected OUTCOME_UNKNOWN, observed ${result.turn.status}`);
    await expectNoSuccessfulReceipt(store, "model-timeout");
    record("model timeout", `turn=${result.turn.status}`);
    await runtime.shutdown();
  }

  // Fault 3: tool outcome unknown — no blind retry, receipt stays OUTCOME_UNKNOWN.
  {
    const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
    const ctx = context(store);
    const patient = [...store.patients.values()].find((candidate) => candidate.organizationId === ctx.organizationId && candidate.unitId === ctx.unitId && candidate.workspaceId === ctx.workspaceId);
    if (!patient) throw new Error("chaos fixture patient missing");
    const runtime = new EmbeddedAgentRuntime({
      store,
      modelProvider: new MockModelProvider({ script: [toolCall("cvg.patient.read", { id: patient.id })] }),
      instanceId: "chaos-3",
      runtimeCommit: "chaos",
      toolExecutor: async () => { throw new ToolGatewayError("OUTCOME_UNKNOWN", "chaos: efeito externo desconhecido"); }
    });
    const first = await runtime.executeTurn(ctx, { sessionId: null, prompt: "tool unknown", purpose: "OPERATIONS", patientId: patient.id, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "chaos-tool-1" });
    if (first.turn.status !== "OUTCOME_UNKNOWN") failures.push(`tool-unknown: expected OUTCOME_UNKNOWN, observed ${first.turn.status}`);
    const unknownReceipts = [...store.commandReceipts.values()].filter((receipt) => receipt.operation.startsWith("tool.") && receipt.status === "OUTCOME_UNKNOWN");
    if (unknownReceipts.length !== 1) failures.push(`tool-unknown: expected exactly one OUTCOME_UNKNOWN receipt, observed ${unknownReceipts.length}`);
    const retry = await runtime.executeTurn(ctx, { sessionId: first.session.id, prompt: "tool unknown", purpose: "OPERATIONS", patientId: patient.id, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "chaos-tool-2" });
    if (retry.turn.status !== "OUTCOME_UNKNOWN" && retry.turn.status !== "DENIED") failures.push(`tool-unknown retry: expected a closed state, observed ${retry.turn.status}`);
    await expectNoSuccessfulReceipt(store, "tool-unknown");
    record("tool OUTCOME_UNKNOWN", `receipts=${unknownReceipts.length} retry=${retry.turn.status}`);
    await runtime.shutdown();
  }

  // Fault 4: session persistence failure downgrades the turn.
  {
    const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
    const ctx = context(store);
    const base = new MemoryAgentSessionStore();
    const failing = new Proxy(base, {
      get(target, property, receiver) {
        if (property === "appendTurn") return async () => { throw new Error("chaos: ledger unavailable"); };
        return Reflect.get(target, property, receiver) as unknown;
      }
    }) as MemoryAgentSessionStore;
    const runtime = new EmbeddedAgentRuntime({ store, modelProvider: new MockModelProvider({ script: [message("ok")] }), sessionStore: failing, instanceId: "chaos-4", runtimeCommit: "chaos" });
    const result = await runtime.executeTurn(ctx, { sessionId: null, prompt: "ledger down", purpose: "SUMMARY", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "chaos-ledger-1" });
    if (result.turn.status !== "OUTCOME_UNKNOWN") failures.push(`ledger-down: expected OUTCOME_UNKNOWN, observed ${result.turn.status}`);
    record("session persistence failure", `turn=${result.turn.status}`);
    await runtime.shutdown();
  }

  // Fault 5 + recovery: WAITING_APPROVAL survives a runtime restart and resumes.
  {
    const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
    const ctx = context(store);
    const sessionStore = new MemoryAgentSessionStore();
    const first = new EmbeddedAgentRuntime({ store, modelProvider: new MockModelProvider({ script: [message("após restart")] }), sessionStore, instanceId: "chaos-5a", runtimeCommit: "chaos" });
    const paused = await first.executeTurn(ctx, { sessionId: null, prompt: "prepare comunicação", purpose: "OPERATIONS", patientId: null, encounterId: null, requestedTool: "cvg.communication.stage", approvalId: null, idempotencyKey: "chaos-approval-1" });
    if (!paused.approval || paused.turn.status !== "RECEIVED") failures.push("restart-approval: pause was not staged");
    await first.approve(ctx, paused.approval!.id, "allowed-once", "chaos restart");
    const checkpoint = await sessionStore.latestCheckpoint(String(paused.session.id), { organizationId: String(ctx.organizationId), actorId: String(ctx.actorId) });
    if (!checkpoint) failures.push("restart-approval: checkpoint missing");
    await first.shutdown();
    // A different runtime instance (same durable store) resumes the session.
    const second = new EmbeddedAgentRuntime({ store, modelProvider: new MockModelProvider({ script: [message("após restart")] }), sessionStore, instanceId: "chaos-5b", runtimeCommit: "chaos" });
    const resumed = await second.executeTurn(ctx, { sessionId: paused.session.id, prompt: "prepare comunicação", purpose: "OPERATIONS", patientId: null, encounterId: null, requestedTool: "cvg.communication.stage", approvalId: paused.approval!.id, idempotencyKey: "chaos-approval-2" });
    if (resumed.turn.status !== "COMPLETED") failures.push(`restart-approval: expected COMPLETED after restart, observed ${resumed.turn.status}`);
    if (store.aiApprovals.get(paused.approval!.id)?.decision !== "consumed") failures.push("restart-approval: approval was not consumed once");
    record("restart during WAITING_APPROVAL", `checkpoint=${checkpoint ? "present" : "missing"} resume=${resumed.turn.status}`);
    await second.shutdown();
  }

  // Fault 6: OUTCOME_UNKNOWN persists across instances and is not converted to retryable.
  {
    const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
    const ctx = context(store);
    const patient = [...store.patients.values()].find((candidate) => candidate.organizationId === ctx.organizationId && candidate.unitId === ctx.unitId && candidate.workspaceId === ctx.workspaceId);
    if (!patient) throw new Error("chaos fixture patient missing");
    const sessionStore = new MemoryAgentSessionStore();
    const first = new EmbeddedAgentRuntime({
      store,
      modelProvider: new MockModelProvider({ script: [toolCall("cvg.patient.read", { id: patient.id })] }),
      sessionStore,
      instanceId: "chaos-6a",
      runtimeCommit: "chaos",
      toolExecutor: async () => { throw new ToolGatewayError("OUTCOME_UNKNOWN", "chaos: perdido"); }
    });
    const unknown = await first.executeTurn(ctx, { sessionId: null, prompt: "perda de resultado", purpose: "OPERATIONS", patientId: patient.id, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "chaos-unknown-persist-1" });
    await first.shutdown();
    const second = new EmbeddedAgentRuntime({ store, modelProvider: new MockModelProvider({ script: [message("não deveria executar")] }), sessionStore, instanceId: "chaos-6b", runtimeCommit: "chaos" });
    const replay = await second.executeTurn(ctx, { sessionId: unknown.session.id, prompt: "perda de resultado", purpose: "OPERATIONS", patientId: patient.id, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "chaos-unknown-persist-1" });
    if (replay.turn.id !== unknown.turn.id || replay.turn.status !== "OUTCOME_UNKNOWN") failures.push("outcome-unknown persistence: replay changed or reopened the unknown outcome");
    await expectNoSuccessfulReceipt(store, "outcome-unknown persistence");
    record("OUTCOME_UNKNOWN across restart", `status=${replay.turn.status}`);
    await second.shutdown();
  }

  // Fault 7: budget port failure stops the loop without a model call.
  {
    const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
    const ctx = context(store);
    let modelCalls = 0;
    const provider = new MockModelProvider({ script: [message("não deveria chamar")] });
    const original = provider.complete.bind(provider);
    provider.complete = async (request) => { modelCalls += 1; return original(request); };
    const failingStore = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "reserveBudget") return () => { throw new Error("chaos: budget port down"); };
        return Reflect.get(target, property, receiver) as unknown;
      }
    }) as CvgStore;
    const runtime = new EmbeddedAgentRuntime({ store: failingStore, modelProvider: provider, instanceId: "chaos-7", runtimeCommit: "chaos" });
    const result = await runtime.executeTurn(ctx, { sessionId: null, prompt: "budget down", purpose: "SUMMARY", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "chaos-budget-1" });
    if (modelCalls !== 0) failures.push(`budget-port-down: expected no model call, observed ${modelCalls}`);
    if (result.turn.status !== "OUTCOME_UNKNOWN") failures.push(`budget-port-down: expected OUTCOME_UNKNOWN, observed ${result.turn.status}`);
    record("budget settlement failure", `modelCalls=${modelCalls} turn=${result.turn.status}`);
    await runtime.shutdown();
  }

  const sha = process.env.CVG_BUILD_SHA ?? process.env.CVG_GIT_SHA ?? "local";
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    subjectSha: sha,
    evidenceClass: "SYNTHETIC",
    faults: results.length,
    results
  };
  mkdirSync("artifacts/operational-proof", { recursive: true });
  writeFileSync("artifacts/operational-proof/agent-chaos-local.json", `${JSON.stringify(artifact, null, 2)}\n`);
  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`AGENT_CHAOS_VERIFIED faults=${results.length} artifact=artifacts/operational-proof/agent-chaos-local.json\n`);
}

await main();
