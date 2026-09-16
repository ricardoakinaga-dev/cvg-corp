import { CvgStore, DomainError } from "@cvg/domain";
import type { CvgContext, OpaqueId } from "@cvg/contracts";
import { EmbeddedAgentRuntime } from "@cvg/embedded-agent-runtime";
import { MemoryAgentSessionStore } from "@cvg/agent-session";
import { MockModelProvider, type MockModelStep } from "@cvg/model-adapters";

/**
 * End-to-end smoke of the embedded runtime: session, governed tool turn,
 * checkpoint, reload/resume after approval and graceful drain.  The model is a
 * deterministic fixture; no external provider is contacted.
 */
const DIGEST = "a".repeat(64);
const step = (tool: string | null, content: string): MockModelStep => ({
  reply: tool ? { kind: "TOOL_CALL", tool, input: {}, callId: "smoke" } : { kind: "MESSAGE", content },
  usage: { inputTokens: 5, outputTokens: 3, costMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC" },
  providerId: "mock-model",
  model: "mock-1",
  responseDigest: DIGEST,
  finishReason: tool ? "tool_calls" : "stop",
  providerRequestId: "smoke",
  retryable: false
});

const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
const vetId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id;
if (!vetId) throw new Error("fixture veterinarian missing");
const option = store.contextOptions(vetId)[0];
if (!option) throw new Error("fixture context option missing");
const session = store.createSession(vetId, "smoke-token", "smoke-csrf", 60);
const context: CvgContext = store.resolveContext(vetId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "smoke", "smoke-correlation", null, null, session.id);
const sessionStore = new MemoryAgentSessionStore();
const runtime = new EmbeddedAgentRuntime({
  store,
  modelProvider: new MockModelProvider({ script: [step(null, "turno concluído"), step(null, "após aprovação")] }),
  sessionStore,
  instanceId: "smoke-instance",
  runtimeCommit: "smoke-commit"
});
const failures: string[] = [];

// 1. create session
const created = await runtime.createSession(context, { purpose: "OPERATIONS", patientId: null, encounterId: null });
if (!created.id) failures.push("session was not created");
// 2. complete a read-only turn through the governed gateway
const readTurn = await runtime.executeTurn(context, { sessionId: created.id, prompt: "leia a agenda", purpose: "OPERATIONS", patientId: null, encounterId: null, requestedTool: "cvg.agenda.read", approvalId: null, idempotencyKey: "smoke-1" });
if (readTurn.turn.status !== "COMPLETED") failures.push(`read turn expected COMPLETED but observed ${readTurn.turn.status}`);
// 3. pause on approval and persist a checkpoint
const paused = await runtime.executeTurn(context, { sessionId: created.id, prompt: "prepare comunicação", purpose: "OPERATIONS", patientId: null, encounterId: null, requestedTool: "cvg.communication.stage", approvalId: null, idempotencyKey: "smoke-2" });
if (paused.turn.status !== "RECEIVED" || !paused.approval) failures.push("approval pause was not staged");
const checkpoint = await sessionStore.latestCheckpoint(String(created.id), { organizationId: String(context.organizationId), actorId: String(context.actorId) });
if (!checkpoint) failures.push("checkpoint was not persisted");
// 4. reload and resume after human approval
await runtime.approve(context, paused.approval!.id, "allowed-once", "smoke review");
const resumed = await runtime.executeTurn(context, { sessionId: created.id, prompt: "prepare comunicação", purpose: "OPERATIONS", patientId: null, encounterId: null, requestedTool: "cvg.communication.stage", approvalId: paused.approval!.id, idempotencyKey: "smoke-3" });
if (resumed.turn.status !== "COMPLETED") failures.push(`resumed turn expected COMPLETED but observed ${resumed.turn.status}`);
// 5. ledger and replay
const turns = await sessionStore.listTurns(String(created.id), { organizationId: String(context.organizationId), actorId: String(context.actorId) });
if (turns.length < 3) failures.push(`turn ledger expected >= 3 entries but observed ${turns.length}`);
const replay = await runtime.replay(context, created.id);
if (replay.digest.length !== 64) failures.push("replay digest malformed");
// 6. stale approval replay is denied
const replayTurn = await runtime.executeTurn(context, { sessionId: created.id, prompt: "prepare comunicação", purpose: "OPERATIONS", patientId: null, encounterId: null, requestedTool: "cvg.communication.stage", approvalId: paused.approval!.id, idempotencyKey: "smoke-4" }).catch((error: unknown) => error);
if (!(replayTurn instanceof DomainError) && (replayTurn as { turn?: { status?: string } }).turn?.status !== "DENIED") failures.push("consumed approval was not denied on replay");
// 7. graceful drain
const drained = await runtime.shutdown();
if (drained !== undefined) failures.push("shutdown must resolve after drain");

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`AGENT_RUNTIME_SMOKE_VERIFIED session=created tool=governed approval=paused checkpoint=${checkpoint!.digest.slice(0, 12)} resume=resumed ledger=${turns.length} drain=clean\n`);
void (null as unknown as OpaqueId);
