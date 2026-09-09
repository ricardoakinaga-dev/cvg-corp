import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AiTurnInput, CvgContext, OpaqueId } from "@cvg/contracts";
import { id } from "@cvg/contracts";
import {
  DeepSeekBridge,
  DeepSeekBridgeError,
  type DeepSeekNativeHarnessPort,
  type DeepSeekNativeBaseRequest,
  type DeepSeekNativeSessionRequest,
  type DeepSeekNativeTurnRequest,
  type DeepSeekNativeApprovalRequest,
  type DeepSeekNativePromotionRequest,
  type DeepSeekNativeReplayRequest
} from "@cvg/deepseek-bridge";
import { DeepSeekHarnessAdapter } from "@cvg/harness-adapters";
import { createDeepSeekBridgeServer } from "../../apps/deepseek-bridge/src/server.ts";

const engineCommit = "approved-commit";
const manifestVersion = "approved-manifest";
const toolNames = ["cvg.ai.summarize"];
const aiSessionId = id("00000000-0000-4000-8000-000000000101");

function context(correlationId = "corr-test"): CvgContext {
  return {
    organizationId: id("org-1"),
    unitId: id("unit-1"),
    workspaceId: id("workspace-1"),
    actorId: id("actor-1"),
    sessionId: id("auth-session-1"),
    actorRoleSnapshot: ["admin"],
    patientId: null,
    encounterId: null,
    purpose: "OPERATIONS",
    policyRevision: "policy-1",
    correlationId
  };
}

function turnInput(sessionId: OpaqueId | null = aiSessionId): AiTurnInput {
  return {
    sessionId,
    prompt: "organize a fila",
    purpose: "OPERATIONS",
    patientId: null,
    encounterId: null,
    requestedTool: null,
    approvalId: null,
    idempotencyKey: "turn-1"
  };
}

function sessionFor(request: DeepSeekNativeSessionRequest | DeepSeekNativeTurnRequest) {
  return {
    id: aiSessionId,
    organizationId: request.context.organizationId,
    actorId: request.context.actorId,
    unitId: request.context.unitId,
    workspaceId: request.context.workspaceId,
    patientId: request.context.patientId,
    encounterId: request.context.encounterId,
    purpose: "OPERATIONS" as const,
    engineCommit,
    profileDigest: "profile-1",
    status: "ACTIVE" as const,
    createdAt: "2026-09-09T20:00:00.000Z"
  };
}

function successfulPort(overrides: Partial<DeepSeekNativeHarnessPort> = {}): DeepSeekNativeHarnessPort {
  const port: DeepSeekNativeHarnessPort = {
    async health(_request: DeepSeekNativeBaseRequest) {
      return { status: "READY", engineCommit, manifestVersion, tools: toolNames, supports: { cancellation: true, approvals: true, replay: true, provenance: true } };
    },
    async createSession(request: DeepSeekNativeSessionRequest) { return sessionFor(request); },
    async executeTurn(request: DeepSeekNativeTurnRequest) {
      const session = sessionFor(request);
      return {
        session,
        turn: { id: id("turn-1"), sessionId: session.id, prompt: request.input.prompt, response: "fila organizada", status: "COMPLETED", model: "deepseek-test", inputTokens: 3, outputTokens: 2, references: [], createdAt: "2026-09-09T20:00:01.000Z" },
        draft: null,
        approval: null,
        provenance: { provider: "deepseek", engineCommit, manifestVersion, profileDigest: "profile-1", policyRevision: request.context.policyRevision, references: [], correlationId: request.correlationId }
      };
    },
    async approve(request: DeepSeekNativeApprovalRequest) {
      return { id: request.approvalId, organizationId: request.context.organizationId, actorId: request.context.actorId, sessionId: aiSessionId, turnId: id("turn-1"), toolName: "cvg.ai.summarize", resourceId: null, patientId: null, encounterId: null, unitId: request.context.unitId, workspaceId: request.context.workspaceId, purpose: "OPERATIONS", requestDigest: "a".repeat(64), policyRevision: request.context.policyRevision, expiresAt: "2026-09-09T20:01:00.000Z", decision: request.decision, decidedBy: request.context.actorId, reason: request.reason, createdAt: "2026-09-09T20:00:00.000Z" };
    },
    async promoteDraft(_request: DeepSeekNativePromotionRequest) {
      return { draft: { id: id("draft-1"), sessionId: aiSessionId, encounterId: null, draftType: "SUMMARY", content: "draft", sourceTurnId: id("turn-1"), status: "PROMOTED", createdAt: "2026-09-09T20:00:00.000Z" }, documentId: id("document-1") };
    },
    async replay(request: DeepSeekNativeReplayRequest) {
      const session = sessionFor({ context: request.context, input: turnInput(aiSessionId), correlationId: request.correlationId, signal: request.signal });
      return { session, turns: [], digest: "b".repeat(64), provenance: { adapterId: "deepseek-harness-bridge", provider: "deepseek", engineCommit, manifestVersion, toolNames, supports: { cancellation: true, approvals: true, replay: true, provenance: true } } };
    },
    async shutdown(_request: DeepSeekNativeBaseRequest) { return undefined; }
  };
  return { ...port, ...overrides };
}

function bridge(port: DeepSeekNativeHarnessPort, requestTimeoutMs = 1_000): DeepSeekBridge {
  return new DeepSeekBridge({ expectedEngineCommit: engineCommit, expectedManifestVersion: manifestVersion, expectedToolNames: toolNames, requestTimeoutMs, nativePort: port });
}

test("DeepSeek bridge is unavailable without an explicit native port and never falls back to Mock", async () => {
  const runtime = new DeepSeekBridge({ expectedEngineCommit: engineCommit, expectedManifestVersion: manifestVersion, expectedToolNames: toolNames, requestTimeoutMs: 500 });
  const health = await runtime.health();
  assert.equal(health.status, "UNAVAILABLE");
  assert.match(health.reason ?? "", /nenhum adapter nativo/i);
  await assert.rejects(() => runtime.createSession(context(), { purpose: "OPERATIONS", patientId: null, encounterId: null }), (error: unknown) => error instanceof DeepSeekBridgeError && error.code === "NATIVE_UNAVAILABLE");
});

test("DeepSeek bridge accepts known-good manifest and preserves correlation/provenance", async () => {
  let observedCorrelation = "";
  const port = successfulPort({
    async executeTurn(request: DeepSeekNativeTurnRequest) {
      observedCorrelation = request.correlationId;
      return successfulPort()["executeTurn"](request);
    }
  });
  const runtime = bridge(port);
  const result = await runtime.executeTurn(context("corr-known-good"), turnInput());
  assert.equal(observedCorrelation, "corr-known-good");
  assert.equal(result.provenance.provider, "deepseek");
  assert.equal(result.provenance.correlationId, "corr-known-good");
});

test("DeepSeek bridge rejects manifest, commit and tool mismatches before any turn", async () => {
  let executeCalls = 0;
  const port = successfulPort({
    async health(_request: DeepSeekNativeBaseRequest) {
      return { status: "READY", engineCommit: "wrong-commit", manifestVersion, tools: ["wrong-tool"], supports: { cancellation: true, approvals: true, replay: true, provenance: true } };
    },
    async executeTurn(_request: DeepSeekNativeTurnRequest) { executeCalls += 1; return {}; }
  });
  const runtime = bridge(port);
  const health = await runtime.health();
  assert.equal(health.status, "UNAVAILABLE");
  await assert.rejects(() => runtime.executeTurn(context(), turnInput()), (error: unknown) => error instanceof DeepSeekBridgeError && error.code === "CONTRACT_MISMATCH");
  assert.equal(executeCalls, 0);
});

test("DeepSeek bridge rejects malformed native responses", async () => {
  const runtime = bridge(successfulPort({ async createSession(_request: DeepSeekNativeSessionRequest) { return { invalid: true }; } }));
  await assert.rejects(() => runtime.createSession(context(), { purpose: "OPERATIONS", patientId: null, encounterId: null }), (error: unknown) => error instanceof DeepSeekBridgeError && error.code === "INVALID_RESPONSE");
});

test("DeepSeek bridge distinguishes timeout and caller cancellation", async () => {
  const hangingPort = successfulPort({
    async createSession(request: DeepSeekNativeSessionRequest) {
      return new Promise((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    }
  });
  const timed = bridge(hangingPort, 100);
  await assert.rejects(() => timed.createSession(context(), { purpose: "OPERATIONS", patientId: null, encounterId: null }), (error: unknown) => error instanceof DeepSeekBridgeError && error.code === "TIMEOUT");

  const controller = new AbortController();
  const cancelled = bridge(hangingPort, 1_000);
  const pending = cancelled.createSession(context(), { purpose: "OPERATIONS", patientId: null, encounterId: null }, controller.signal);
  controller.abort();
  await assert.rejects(() => pending, (error: unknown) => error instanceof DeepSeekBridgeError && error.code === "CANCELLED");
});

test("HTTP bridge exposes structured unavailable health and errors without a native port", async () => {
  const created = createDeepSeekBridgeServer();
  created.server.listen(0, "127.0.0.1");
  await once(created.server, "listening");
  const address = created.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const healthResponse = await fetch(`${baseUrl}/v1/health`, { headers: { "x-cvg-correlation-id": "corr-http-health" } });
  const health = await healthResponse.json() as { status: string; tools: string[] };
  assert.equal(healthResponse.status, 200);
  assert.equal(health.status, "UNAVAILABLE");
  assert.deepEqual(health.tools, []);

  const sessionResponse = await fetch(`${baseUrl}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cvg-correlation-id": "corr-http-session" },
    body: JSON.stringify({ context: context("corr-http-session"), input: { purpose: "OPERATIONS", patientId: null, encounterId: null } })
  });
  const error = await sessionResponse.json() as { schemaVersion: number; correlationId: string; error: { code: string } };
  assert.equal(sessionResponse.status, 503);
  assert.equal(error.schemaVersion, 1);
  assert.equal(error.correlationId, "corr-http-session");
  assert.equal(error.error.code, "NATIVE_UNAVAILABLE");
  created.server.closeAllConnections();
  await new Promise<void>((resolveClose, rejectClose) => created.server.close((closeError) => closeError ? rejectClose(closeError) : resolveClose()));
});

test("HTTP bridge and provider-neutral adapter complete a known-good synthetic protocol round trip", async () => {
  const created = createDeepSeekBridgeServer({ bridge: bridge(successfulPort()) });
  created.server.listen(0, "127.0.0.1");
  await once(created.server, "listening");
  const address = created.server.address();
  assert.ok(address && typeof address === "object");
  const adapter = new DeepSeekHarnessAdapter({ baseUrl: `http://127.0.0.1:${address.port}`, expectedEngineCommit: engineCommit, expectedManifestVersion: manifestVersion, expectedToolNames: toolNames, requestTimeoutMs: 1_000, allowInsecureHttp: true });
  const runtimeContext = context("corr-adapter");
  assert.equal((await adapter.health()).status, "READY");
  const session = await adapter.createSession(runtimeContext, { purpose: "OPERATIONS", patientId: null, encounterId: null });
  const result = await adapter.executeTurn(runtimeContext, turnInput(session.id));
  assert.equal(result.provenance.correlationId, "corr-adapter");
  const replay = await adapter.replay(runtimeContext, session.id);
  assert.equal(replay.session.id, session.id);
  await adapter.shutdown();
  created.server.closeAllConnections();
  await new Promise<void>((resolveClose, rejectClose) => created.server.close((closeError) => closeError ? rejectClose(closeError) : resolveClose()));
});
