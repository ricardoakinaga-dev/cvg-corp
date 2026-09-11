import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiTurn, AiTurnInput, CvgContext, OpaqueId } from "@cvg/contracts";
import { id } from "@cvg/contracts";
import {
  DeepSeekBridge,
  bridgeRequestSignature,
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
import { replayDigest } from "@cvg/agent-runtime";
import { createDeepSeekBridgeServer } from "../../apps/deepseek-bridge/src/server.ts";
import { runDeepSeekProtocolSmoke } from "../../scripts/verify-deepseek-real.ts";

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
        turn: { id: id("turn-1"), sessionId: session.id, prompt: request.input.prompt, response: "fila organizada", status: "COMPLETED", model: "deepseek-test", inputTokens: 3, outputTokens: 2, references: [], usage: { id: id("usage-1"), reservationId: null, providerRequestId: "provider-request-1", idempotencyKey: "turn-1", usageKind: "TOKENS", reservedUnits: 5, consumedUnits: 5, status: "SETTLED", record: { kind: "AI_TURN_USAGE" } }, createdAt: "2026-09-09T20:00:01.000Z" },
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
      return { session, turns: [], digest: replayDigest(session, []), provenance: { adapterId: "deepseek-harness-bridge", provider: "deepseek", engineCommit, manifestVersion, toolNames, supports: { cancellation: true, approvals: true, replay: true, provenance: true } } };
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

test("DeepSeek bridge rejects an approval envelope that disagrees with the turn input", async () => {
  const runtime = bridge(successfulPort());
  await assert.rejects(() => runtime.executeTurn(context(), { ...turnInput(), approvalId: id("00000000-0000-4000-8000-000000000301") }, id("00000000-0000-4000-8000-000000000302")), (error: unknown) => error instanceof DeepSeekBridgeError && error.code === "CONTRACT_MISMATCH");
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

test("DeepSeek bridge does not report readiness when native capabilities are incomplete", async () => {
  const runtime = bridge(successfulPort({
    async health(_request: DeepSeekNativeBaseRequest) {
      return { status: "READY", engineCommit, manifestVersion, tools: toolNames, supports: { cancellation: true, approvals: false, replay: false, provenance: true } };
    }
  }));
  const health = await runtime.health();
  assert.equal(health.status, "UNAVAILABLE");
  assert.match(health.reason ?? "", /capabilities obrigatórias/i);
  await assert.rejects(() => runtime.createSession(context(), { purpose: "OPERATIONS", patientId: null, encounterId: null }), (error: unknown) => error instanceof DeepSeekBridgeError && error.code === "NATIVE_UNAVAILABLE");
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

test("HTTP bridge rejects a degraded file SecretProvider even when the named secret exists", () => {
  const secretDir = mkdtempSync(join(tmpdir(), "cvg-bridge-secret-"));
  writeFileSync(join(secretDir, "bridge.token"), "synthetic-bridge-token\n", { mode: 0o600 });
  const keys = ["CVG_SECRET_PROVIDER", "CVG_SECRET_DIR", "CVG_DEEPSEEK_BEARER_TOKEN_REF"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.CVG_SECRET_PROVIDER = "file";
  process.env.CVG_SECRET_DIR = secretDir;
  process.env.CVG_DEEPSEEK_BEARER_TOKEN_REF = "bridge.token";
  try {
    assert.throws(() => createDeepSeekBridgeServer({ bridge: bridge(successfulPort()), requireBearerToken: true }), /SecretProvider/);
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(secretDir, { recursive: true, force: true });
  }
});

test("HTTP bridge requires a bearer token when configured and never accepts caller identity alone", async () => {
  const created = createDeepSeekBridgeServer({ requireBearerToken: true, resolveBearerToken: async () => "synthetic-bridge-token" });
  created.server.listen(0, "127.0.0.1");
  await once(created.server, "listening");
  const address = created.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const body = JSON.stringify({ context: context("corr-auth"), input: { purpose: "OPERATIONS", patientId: null, encounterId: null } });
  const unauthorized = await fetch(`${baseUrl}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", "x-cvg-correlation-id": "corr-auth" }, body });
  const unauthorizedBody = await unauthorized.json() as { error: { code: string } };
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorizedBody.error.code, "UNAUTHENTICATED");
  const authorized = await fetch(`${baseUrl}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer synthetic-bridge-token", "x-cvg-correlation-id": "corr-auth" }, body });
  assert.equal(authorized.status, 503);
  created.server.closeAllConnections();
  await new Promise<void>((resolveClose, rejectClose) => created.server.close((closeError) => closeError ? rejectClose(closeError) : resolveClose()));
});

test("HTTP bridge binds the caller-supplied context to an HMAC and the adapter signs POST and GET calls", async () => {
  const contextSecret = "synthetic-context-signing-secret";
  const created = createDeepSeekBridgeServer({ bridge: bridge(successfulPort()), requireContextSignature: true, resolveContextSigningSecret: async () => contextSecret });
  created.server.listen(0, "127.0.0.1");
  await once(created.server, "listening");
  const address = created.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const runtimeContext = context("corr-context-signature");
  const unsigned = await fetch(`${baseUrl}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", "x-cvg-correlation-id": runtimeContext.correlationId }, body: JSON.stringify({ context: runtimeContext, input: { purpose: "OPERATIONS", patientId: null, encounterId: null } }) });
  const unsignedBody = await unsigned.json() as { error: { code: string } };
  assert.equal(unsigned.status, 401);
  assert.equal(unsignedBody.error.code, "UNAUTHENTICATED");
  const issuedAt = String(Date.now());
  const originalPayload = { context: runtimeContext, input: { purpose: "OPERATIONS", patientId: null, encounterId: null } };
  const signedOriginal = bridgeRequestSignature(contextSecret, "POST", "/v1/sessions", issuedAt, originalPayload);
  const tamperedContext = { ...runtimeContext, actorId: id("actor-tampered") };
  const tampered = await fetch(`${baseUrl}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", "x-cvg-correlation-id": runtimeContext.correlationId, "x-cvg-context-issued-at": issuedAt, "x-cvg-context-signature": `sha256=${signedOriginal}` }, body: JSON.stringify({ ...originalPayload, context: tamperedContext }) });
  assert.equal(tampered.status, 401);

  const adapter = new DeepSeekHarnessAdapter({ baseUrl, expectedEngineCommit: engineCommit, expectedManifestVersion: manifestVersion, expectedToolNames: toolNames, requestTimeoutMs: 1_000, allowInsecureHttp: true, resolveContextSigningSecret: async () => contextSecret });
  const session = await adapter.createSession(runtimeContext, { purpose: "OPERATIONS", patientId: null, encounterId: null });
  const replay = await adapter.replay(runtimeContext, session.id);
  assert.equal(replay.session.id, session.id);
  const nonce = "replay-protection-nonce-1";
  const nonceIssuedAt = String(Date.now());
  const signedBody = { context: runtimeContext, input: { purpose: "OPERATIONS", patientId: null, encounterId: null } };
  const signedHeaders = { "content-type": "application/json", "x-cvg-correlation-id": runtimeContext.correlationId, "x-cvg-context-issued-at": nonceIssuedAt, "x-cvg-request-nonce": nonce, "x-cvg-context-signature": `sha256=${bridgeRequestSignature(contextSecret, "POST", "/v1/sessions", nonceIssuedAt, signedBody, nonce)}` };
  const firstNonceUse = await fetch(`${baseUrl}/v1/sessions`, { method: "POST", headers: signedHeaders, body: JSON.stringify(signedBody) });
  assert.equal(firstNonceUse.status, 200);
  const replayedNonce = await fetch(`${baseUrl}/v1/sessions`, { method: "POST", headers: signedHeaders, body: JSON.stringify(signedBody) });
  assert.equal(replayedNonce.status, 401);
  await adapter.shutdown();
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

test("HTTP bridge rejects expired, future and request-rebound signatures before native execution", async (t) => {
  const secret = "synthetic-request-key";
  let executions = 0;
  const created = createDeepSeekBridgeServer({ bridge: bridge(successfulPort({ async executeTurn(request) { executions += 1; return successfulPort().executeTurn(request); } })), requireContextSignature: true, resolveContextSigningSecret: async () => secret });
  created.server.listen(0, "127.0.0.1");
  await once(created.server, "listening");
  t.after(async () => { created.server.closeAllConnections(); await new Promise<void>((resolve) => created.server.close(() => resolve())); });
  const address = created.server.address();
  assert.ok(address && typeof address === "object");
  const path = `/v1/sessions/${aiSessionId}/turns`;
  const payload = { context: context(), input: turnInput() };
  for (const scenario of [
    { name: "expired", issuedAt: String(Date.now() - 61_000) },
    { name: "future", issuedAt: String(Date.now() + 60_000) },
    { name: "method", signedMethod: "GET" },
    { name: "path", signedPath: "/v1/sessions/another/turns" },
    { name: "arguments", signedPayload: { ...payload, input: { ...payload.input, prompt: "other prompt" } } }
  ]) {
    const issuedAt = scenario.issuedAt ?? String(Date.now());
    const signature = bridgeRequestSignature(secret, scenario.signedMethod ?? "POST", scenario.signedPath ?? path, issuedAt, scenario.signedPayload ?? payload);
    const response: Response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-cvg-context-issued-at": issuedAt, "x-cvg-context-signature": `sha256=${signature}` }, body: JSON.stringify(payload) });
    assert.equal(response.status, 401, scenario.name);
  }
  const otherPath = "/v1/sessions/another/turns";
  const issuedAt = String(Date.now());
  const nonce = "other-path-nonce-1234";
  const response = await fetch(`http://127.0.0.1:${address.port}${otherPath}`, { method: "POST", headers: { "content-type": "application/json", "x-cvg-context-issued-at": issuedAt, "x-cvg-request-nonce": nonce, "x-cvg-context-signature": `sha256=${bridgeRequestSignature(secret, "POST", otherPath, issuedAt, payload, nonce)}` }, body: JSON.stringify(payload) });
  assert.equal(response.status, 502, "authenticated path/body session mismatch");
  assert.equal(executions, 0);
});

test("HTTP disconnect after request body delivery cancels the native turn", async (t) => {
  let entered!: () => void;
  let cancelled!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const aborted = new Promise<void>((resolve) => { cancelled = resolve; });
  const created = createDeepSeekBridgeServer({ bridge: bridge(successfulPort({ async executeTurn(request) {
    entered();
    return new Promise((_resolve, reject) => request.signal.addEventListener("abort", () => { cancelled(); reject(new Error("cancelled")); }, { once: true }));
  } }), 2_000) });
  created.server.listen(0, "127.0.0.1");
  await once(created.server, "listening");
  t.after(async () => { created.server.closeAllConnections(); await new Promise<void>((resolve) => created.server.close(() => resolve())); });
  const address = created.server.address();
  assert.ok(address && typeof address === "object");
  const controller = new AbortController();
  const pending = fetch(`http://127.0.0.1:${address.port}/v1/sessions/${aiSessionId}/turns`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context: context(), input: turnInput() }), signal: controller.signal });
  const rejected = assert.rejects(pending);
  await started;
  controller.abort();
  await rejected;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([aborted, new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error("native cancellation not propagated")), 500); })]); }
  finally { clearTimeout(deadline); }
});

test("real-proof smoke accepts the actual structured wire shape and rejects missing or altered replay", async (t) => {
  let observedAuthSession: OpaqueId | null | undefined;
  let replayMode: "valid" | "missing" | "altered" = "valid";
  const port = successfulPort({
    async executeTurn(request) { observedAuthSession = request.context.sessionId; return successfulPort().executeTurn(request); },
    async replay(request) {
      const base = await successfulPort().replay(request) as Record<string, unknown>;
      const result = await successfulPort().executeTurn({ ...request, input: turnInput(), approvalId: null }) as { turn: Record<string, unknown> };
      const turns = replayMode === "missing" ? [] : [{ ...result.turn, ...(replayMode === "altered" ? { response: "tampered" } : {}) }] as AiTurn[];
      return { ...base, turns, digest: replayDigest(base.session as { engineCommit: string; profileDigest: string }, turns) };
    }
  });
  const created = createDeepSeekBridgeServer({ bridge: bridge(port) });
  created.server.listen(0, "127.0.0.1");
  await once(created.server, "listening");
  t.after(async () => { created.server.closeAllConnections(); await new Promise<void>((resolve) => created.server.close(() => resolve())); });
  const address = created.server.address();
  assert.ok(address && typeof address === "object");
  const adapter = new DeepSeekHarnessAdapter({ baseUrl: `http://127.0.0.1:${address.port}`, expectedEngineCommit: engineCommit, expectedManifestVersion: manifestVersion, expectedToolNames: toolNames, requestTimeoutMs: 1_000, allowInsecureHttp: true });
  const run = () => runDeepSeekProtocolSmoke(adapter, context(), { purpose: "OPERATIONS", patientId: null, encounterId: null }, turnInput());
  const evidence = await run();
  assert.equal(evidence.status, "VERIFIED_PROTOCOL_ONLY");
  assert.equal(observedAuthSession, context().sessionId);
  replayMode = "missing";
  await assert.rejects(run, /exact completed turn/);
  replayMode = "altered";
  await assert.rejects(run, /exact completed turn/);
});

test("bridge independently rejects each identity drift and rechecks identity after native restart", async () => {
  for (const mismatch of [{ engineCommit: "wrong-commit" }, { manifestVersion: "wrong-manifest" }, { tools: ["wrong-tool"] }]) {
    let restarted = false;
    let executions = 0;
    const port = successfulPort({
      async health(request) { return { ...await successfulPort().health(request) as Record<string, unknown>, ...(restarted ? mismatch : {}) }; },
      async executeTurn(request) { executions += 1; return successfulPort().executeTurn(request); }
    });
    const runtime = bridge(port);
    assert.equal((await runtime.health()).status, "READY");
    restarted = true;
    await assert.rejects(() => runtime.executeTurn(context(), turnInput()), (error: unknown) => error instanceof DeepSeekBridgeError && error.code === "CONTRACT_MISMATCH");
    assert.equal(executions, 0);
  }
});

test("adapter rejects a stale session engine and draft bound to another turn", async (t) => {
  let staleEngine = true;
  const created = createDeepSeekBridgeServer({ bridge: bridge(successfulPort({
    async createSession(request) { return { ...sessionFor(request), engineCommit: "stale-engine" }; },
    async executeTurn(request) {
      const result = await successfulPort().executeTurn(request) as Record<string, unknown>;
      return { ...result, session: { ...sessionFor(request), ...(staleEngine ? { engineCommit: "stale-engine" } : {}) }, draft: staleEngine ? null : { id: id("draft-1"), sessionId: aiSessionId, encounterId: null, draftType: "SUMMARY", content: "draft", sourceTurnId: id("another-turn"), status: "DRAFT", createdAt: "2026-09-09T20:00:00.000Z" } };
    }
  })) });
  created.server.listen(0, "127.0.0.1");
  await once(created.server, "listening");
  t.after(async () => { created.server.closeAllConnections(); await new Promise<void>((resolve) => created.server.close(() => resolve())); });
  const address = created.server.address();
  assert.ok(address && typeof address === "object");
  const adapter = new DeepSeekHarnessAdapter({ baseUrl: `http://127.0.0.1:${address.port}`, expectedEngineCommit: engineCommit, expectedManifestVersion: manifestVersion, expectedToolNames: toolNames, requestTimeoutMs: 1_000, allowInsecureHttp: true });
  await assert.rejects(() => adapter.createSession(context(), { purpose: "OPERATIONS", patientId: null, encounterId: null }), /engine commit|HTTP 502/);
  await assert.rejects(() => adapter.executeTurn(context(), turnInput()), /engine\/profile|HTTP 502/);
  staleEngine = false;
  await assert.rejects(() => adapter.executeTurn(context(), turnInput()), /rascunho|HTTP 502/);
});
