import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { id, type AiApproval, type AiSession, type AiTurnInput, type CvgContext } from "@cvg/contracts";
import { createAcpNativeHarnessPortFromEnvironment, DeepSeekAcpNativeHarnessPort, DeepSeekBridge, DeepSeekBridgeError, readAcpManifestVersion, type DeepSeekAcpGovernance } from "@cvg/deepseek-bridge";
import { DeepSeekHarnessAdapter } from "@cvg/harness-adapters";
import { createDeepSeekBridgeServer } from "../../apps/deepseek-bridge/src/server.ts";

test("ACP factory stays disabled until the complete explicit deployment contract exists", () => {
  assert.equal(createAcpNativeHarnessPortFromEnvironment({}), undefined);
  assert.equal(createAcpNativeHarnessPortFromEnvironment({
    CVG_DEEPSEEK_ACP_COMMAND: "node",
    CVG_DEEPSEEK_ACP_ENGINE_ROOT: "/srv/deepseek-harness",
    CVG_DEEPSEEK_ACP_WORKSPACE_ROOT: "/srv/cvg-workspace",
    CVG_DEEPSEEK_ACP_MANIFEST_PATH: "/srv/dsh-home/profiles/acp/package.json",
    CVG_DEEPSEEK_ACP_ARGS_JSON: "not-json",
    CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT: "approved",
    CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION: "sha256:approved"
  }), undefined);
});

test("ACP manifest attestation hashes the exact profile and requires the ACP bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "cvg-acp-manifest-test-"));
  const manifestPath = join(root, "package.json");
  await writeFile(manifestPath, JSON.stringify({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-acp-app"] } } }));
  try {
    const version = await readAcpManifestVersion(manifestPath);
    assert.match(version, /^sha256:[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP native port blocks an ungoverned model turn", async () => {
  const port = new DeepSeekAcpNativeHarnessPort({ command: "node", args: [], engineRoot: "/tmp/deepseek-engine", workspaceRoot: "/tmp/cvg-workspace", manifestPath: "/tmp/deepseek-manifest.json", expectedAgentName: "deepseek-harness-acp", modelName: "deepseek-acp" });
  await assert.rejects(() => port.executeTurn({} as Parameters<DeepSeekAcpNativeHarnessPort["executeTurn"]>[0]), (error: unknown) => error instanceof DeepSeekBridgeError && error.code === "CAPABILITY_DISABLED");
  await assert.rejects(() => port.approve({} as Parameters<DeepSeekAcpNativeHarnessPort["approve"]>[0]), (error: unknown) => error instanceof DeepSeekBridgeError && error.code === "CAPABILITY_DISABLED");
  await assert.rejects(() => port.replay({} as Parameters<DeepSeekAcpNativeHarnessPort["replay"]>[0]), (error: unknown) => error instanceof DeepSeekBridgeError && error.code === "CAPABILITY_DISABLED");
});

test("governed ACP crosses authorization and durable-result seams before returning a model turn", async () => {
  const root = await mkdtemp(join(tmpdir(), "cvg-acp-governed-test-"));
  const manifestPath = join(root, "package.json");
  const agentPath = join(root, "agent.mjs");
  await writeFile(manifestPath, JSON.stringify({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-acp-app"] } } }));
  const acpModuleUrl = pathToFileURL(resolve(process.cwd(), "node_modules/@agentclientprotocol/sdk/dist/acp.js")).href;
  await writeFile(agentPath, [
    `import * as acp from ${JSON.stringify(acpModuleUrl)};`,
    "import { Readable, Writable } from 'node:stream';",
    "const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));",
    "let usageInput = 0; let usageOutput = 0;",
    "acp.agent({ name: 'deepseek-harness-acp', version: 'fixture' })",
    "  .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentInfo: { name: 'deepseek-harness-acp', version: 'fixture' }, agentCapabilities: { loadSession: false } }))",
    "  .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'acp-fixture-session-' + process.pid }))",
    "  .onRequest(acp.methods.agent.session.prompt, async (ctx) => { const text = ctx.params.prompt?.[0]?.type === 'text' ? ctx.params.prompt[0].text : ''; if (text.includes('slow queue')) await new Promise((resolve) => setTimeout(resolve, 200)); if (text.includes('overflow')) await ctx.client.notify(acp.methods.client.session.update, { sessionId: ctx.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x'.repeat(1000001) } } }); if (text.includes('crash')) process.kill(process.pid, 'SIGKILL'); if (text.includes('tool')) await ctx.client.notify(acp.methods.client.session.update, { sessionId: ctx.params.sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 'fixture-tool-call', title: 'ungoverned fixture tool', kind: 'read', status: 'pending' } }); await ctx.client.notify(acp.methods.client.session.update, { sessionId: ctx.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'fixture response' } } }); if (text.includes('missing usage')) return { stopReason: 'end_turn' }; if (text.includes('regress usage')) return { stopReason: 'end_turn', usage: { totalTokens: 1, inputTokens: 1, outputTokens: 0 } }; usageInput += 4; usageOutput += 3; return { stopReason: 'end_turn', usage: { totalTokens: usageInput + usageOutput, inputTokens: usageInput, outputTokens: usageOutput } }; })",
    "  .connect(stream);"
  ].join("\n"));
  const engineRoot = resolve(process.cwd());
  const engineCommit = execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: engineRoot, encoding: "utf8" }).trim();
  const manifestVersion = await readAcpManifestVersion(manifestPath);
  const organizationId = id("00000000-0000-4000-8000-000000000201");
  const unitId = id("00000000-0000-4000-8000-000000000202");
  const workspaceId = id("00000000-0000-4000-8000-000000000203");
  const actorId = id("00000000-0000-4000-8000-000000000204");
  const authSessionId = id("00000000-0000-4000-8000-000000000205");
  const aiSessionId = id("00000000-0000-4000-8000-000000000206");
  const context: CvgContext = { organizationId, unitId, workspaceId, actorId, sessionId: authSessionId, actorRoleSnapshot: ["admin"], patientId: null, encounterId: null, purpose: "OPERATIONS", policyRevision: "fixture-policy", correlationId: "acp-governed-fixture" };
  const input: AiTurnInput = { sessionId: aiSessionId, prompt: "organize a fila", purpose: "OPERATIONS", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "acp-fixture-1" };
  const session: AiSession = { id: aiSessionId, organizationId, actorId, unitId, workspaceId, patientId: null, encounterId: null, purpose: "OPERATIONS", engineCommit, profileDigest: manifestVersion, status: "ACTIVE", createdAt: "2026-09-10T00:00:00.000Z" };
  let authorizationCalls = 0;
  let recordCalls = 0;
  let lastReason: string | undefined;
  const governance: DeepSeekAcpGovernance = {
    toolNames: ["cvg.agenda.read"],
    async createSession() { return session; },
    async loadSession() { return session; },
    async authorizeTurn() { authorizationCalls += 1; return { disposition: "ALLOW" }; },
    async recordTurn(_context, persistedSession, persistedInput, outcome) {
      recordCalls += 1;
      lastReason = outcome.reason;
      return {
        session: persistedSession,
        turn: { id: id("00000000-0000-4000-8000-000000000207"), sessionId: persistedSession.id, prompt: persistedInput.prompt, response: outcome.response, status: outcome.status, model: outcome.model, inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens, references: [], provenance: { provider: "deepseek", engineCommit, manifestVersion, profileDigest: manifestVersion, policyRevision: context.policyRevision, references: [], correlationId: outcome.correlationId, usageRecordId: id("00000000-0000-4000-8000-000000000208") }, usage: { id: id("00000000-0000-4000-8000-000000000208"), reservationId: null, providerRequestId: null, idempotencyKey: `acp-fixture:${persistedInput.idempotencyKey}`, usageKind: "TOKENS", reservedUnits: outcome.inputTokens + outcome.outputTokens, consumedUnits: outcome.inputTokens + outcome.outputTokens, status: outcome.status === "OUTCOME_UNKNOWN" ? "RECONCILIATION_REQUIRED" : "SETTLED", record: { kind: "AI_TURN_USAGE", reason: outcome.reason ?? null } }, createdAt: "2026-09-10T00:00:01.000Z" },
        draft: null,
        approval: null
      };
    },
    async approve() { return {} as AiApproval; },
    async promoteDraft() { return {} as never; },
    async replay() { return { session, turns: [], digest: "a".repeat(64) }; }
  };
  const port = new DeepSeekAcpNativeHarnessPort({ command: process.execPath, args: [agentPath], engineRoot, workspaceRoot: root, manifestPath, expectedAgentName: "deepseek-harness-acp", expectedAgentVersion: "fixture", modelName: "deepseek-acp-fixture", governance });
  const controller = new AbortController();
  try {
    const health = await port.health({ correlationId: context.correlationId, signal: controller.signal }) as { status: string; tools: string[]; supports: { approvals: boolean; replay: boolean } };
    assert.equal(health.status, "READY", JSON.stringify(health));
    assert.deepEqual(health.tools, ["cvg.agenda.read"]);
    assert.equal(health.supports.approvals, true);
    assert.equal(health.supports.replay, true);
    const created = await port.createSession({ correlationId: context.correlationId, signal: controller.signal, context, input });
    assert.equal((created as AiSession).id, aiSessionId);
    const result = await port.executeTurn({ correlationId: context.correlationId, signal: controller.signal, context, input, approvalId: null }) as { turn: { response: string | null; status: string }; provenance: { provider: string } };
    assert.equal(result.turn.response, "fixture response");
    assert.equal(result.turn.status, "COMPLETED");
    assert.equal(result.provenance.provider, "deepseek");
    assert.equal(authorizationCalls, 1);
    assert.equal(recordCalls, 1);
    await port.shutdown({ correlationId: context.correlationId, signal: controller.signal });
    const afterRestart = await port.executeTurn({ correlationId: context.correlationId, signal: controller.signal, context, input, approvalId: null }) as { turn: { response: string | null; status: string } };
    assert.equal(afterRestart.turn.response, "fixture response");
    assert.equal(afterRestart.turn.status, "COMPLETED");
    assert.equal(authorizationCalls, 2);
    assert.equal(recordCalls, 2);
    const toolInput: AiTurnInput = { ...input, prompt: "tool call please", idempotencyKey: "acp-fixture-tool" };
    const toolResult = await port.executeTurn({ correlationId: context.correlationId, signal: controller.signal, context, input: toolInput, approvalId: null }) as { turn: { status: string } };
    assert.equal(toolResult.turn.status, "OUTCOME_UNKNOWN");
    assert.equal(lastReason, "ACP_TOOL_CALL_WITHOUT_CVG_EXECUTOR");
    assert.equal(authorizationCalls, 3);
    assert.equal(recordCalls, 3);
    const recovered = await port.executeTurn({ correlationId: context.correlationId, signal: controller.signal, context, input: { ...input, prompt: "organize again", idempotencyKey: "acp-fixture-recovered" }, approvalId: null }) as { turn: { status: string } };
    assert.equal(recovered.turn.status, "COMPLETED");
    assert.equal(authorizationCalls, 4);
    assert.equal(recordCalls, 4);

    const bridgeRuntime = new DeepSeekBridge({ expectedEngineCommit: engineCommit, expectedManifestVersion: manifestVersion, expectedToolNames: ["cvg.agenda.read"], requestTimeoutMs: 1_000, nativePort: port });
    const http = createDeepSeekBridgeServer({ bridge: bridgeRuntime });
    http.server.listen(0, "127.0.0.1");
    await once(http.server, "listening");
    try {
      const address = http.server.address();
      assert.ok(address && typeof address === "object");
      const adapter = new DeepSeekHarnessAdapter({ baseUrl: `http://127.0.0.1:${address.port}`, expectedEngineCommit: engineCommit, expectedManifestVersion: manifestVersion, expectedToolNames: ["cvg.agenda.read"], requestTimeoutMs: 1_000, allowInsecureHttp: true });
      const roundTrip = await adapter.executeTurn(context, { ...input, prompt: "http governed turn", idempotencyKey: "acp-fixture-http" });
      assert.equal(roundTrip.turn.provenance?.provider, "deepseek");
      assert.equal(roundTrip.turn.usage?.status, "SETTLED");
      assert.equal(roundTrip.turn.usage?.consumedUnits, 7);
      assert.equal(authorizationCalls, 5);
      assert.equal(recordCalls, 5);
    } finally {
      http.server.closeAllConnections();
      await new Promise<void>((resolveClose, rejectClose) => http.server.close((closeError) => closeError ? rejectClose(closeError) : resolveClose()));
    }

    const crashed = await port.executeTurn({ correlationId: context.correlationId, signal: controller.signal, context, input: { ...input, prompt: "crash child now", idempotencyKey: "acp-fixture-crash" }, approvalId: null }) as { turn: { status: string } };
    assert.equal(crashed.turn.status, "OUTCOME_UNKNOWN");
    assert.equal(lastReason, "ACP_PROMPT_OUTCOME_UNKNOWN");
    const recoveredAfterCrash = await port.executeTurn({ correlationId: context.correlationId, signal: controller.signal, context, input: { ...input, prompt: "resume after restart", idempotencyKey: "acp-fixture-after-crash" }, approvalId: null }) as { turn: { status: string } };
    assert.equal(recoveredAfterCrash.turn.status, "COMPLETED");
    const overflow = await port.executeTurn({ correlationId: context.correlationId, signal: controller.signal, context, input: { ...input, prompt: "overflow", idempotencyKey: "acp-fixture-overflow" }, approvalId: null }) as { turn: { status: string; response: string | null } };
    assert.equal(overflow.turn.status, "OUTCOME_UNKNOWN");
    assert.equal(lastReason, "ACP_OUTPUT_LIMIT_EXCEEDED");
    assert.ok((overflow.turn.response?.length ?? 0) <= 1_000_000);
    const flooded = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => port.executeTurn({ correlationId: context.correlationId, signal: controller.signal, context, input: { ...input, prompt: "slow queue", idempotencyKey: `acp-fixture-queue-${index}` }, approvalId: null })));
    assert.equal(flooded.filter((result) => result.status === "fulfilled").length, 8);
    assert.equal(flooded.filter((result) => result.status === "rejected" && result.reason instanceof DeepSeekBridgeError && result.reason.code === "DEPENDENCY_UNAVAILABLE").length, 4);
    const missingUsage = await port.executeTurn({ correlationId: context.correlationId, signal: controller.signal, context, input: { ...input, prompt: "missing usage", idempotencyKey: "acp-fixture-missing-usage" }, approvalId: null }) as { turn: { status: string } };
    assert.equal(missingUsage.turn.status, "OUTCOME_UNKNOWN");
    assert.equal(lastReason, "ACP_USAGE_UNAVAILABLE");
    const regressedUsage = await port.executeTurn({ correlationId: context.correlationId, signal: controller.signal, context, input: { ...input, prompt: "regress usage", idempotencyKey: "acp-fixture-regressed-usage" }, approvalId: null }) as { turn: { status: string } };
    assert.equal(regressedUsage.turn.status, "OUTCOME_UNKNOWN");
    assert.equal(lastReason, "ACP_USAGE_COUNTER_REGRESSION");
  } finally {
    await port.shutdown({ correlationId: context.correlationId, signal: controller.signal });
    await rm(root, { recursive: true, force: true });
  }
});

test("real DeepSeek Harness ACP boundary initializes only when explicitly enabled", { skip: process.env.CVG_DEEPSEEK_ACP_E2E !== "1" }, async () => {
  const port = createAcpNativeHarnessPortFromEnvironment(process.env);
  assert.ok(port);
  const controller = new AbortController();
  const health = await port.health({ correlationId: "test-deepseek-acp", signal: controller.signal });
  assert.equal(typeof health, "object");
  await port.shutdown({ correlationId: "test-deepseek-acp", signal: controller.signal });
});
